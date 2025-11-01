const express = require('express');
const multer = require('multer');
const File = require('../models/File');
const Transaction = require('../models/Transaction');
const { authenticateToken } = require('../middleware/auth');
const fileService = require('../services/fileService');
const transactionService = require('../services/transactionService');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/pdf'
    ];

    if (allowedTypes.includes(file.mimetype) ||
        file.originalname.match(/\.(xlsx|xls|csv|pdf)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});

// Upload file
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.user._id;
    const { buffer, originalname, mimetype, size } = req.file;

    // Upload to MinIO
    const { s3Key } = await fileService.uploadFile(userId, buffer, originalname, mimetype);

    // Detect file type
    let fileType = fileService.determineTransactionType(originalname, buffer.toString());

    // PATCH: If PDF and fileType is 'unknown', check if it looks like a bank file
    if (fileType === 'unknown' && originalname.toLowerCase().endsWith('.pdf')) {
      // Check if filename suggests it's a bank statement
      const filenameLower = originalname.toLowerCase();
      if (filenameLower.includes('banco') || filenameLower.includes('banesco') || 
          filenameLower.includes('mercantil') || filenameLower.includes('provincial') ||
          filenameLower.includes('movimiento') || filenameLower.includes('estado') || 
          filenameLower.includes('cuenta')) {
        fileType = 'bank';
      } else {
        fileType = 'pdf';
      }
    }
    // PATCH: If CSV/XLSX/XLS/TXT, set type to extension
    if (fileType === 'unknown' && originalname.toLowerCase().endsWith('.csv')) {
      fileType = 'csv';
    }
    if (fileType === 'unknown' && originalname.toLowerCase().endsWith('.xlsx')) {
      fileType = 'xlsx';
    }
    if (fileType === 'unknown' && originalname.toLowerCase().endsWith('.xls')) {
      fileType = 'xlsx'; // treat xls as xlsx
    }
    if (fileType === 'unknown' && originalname.toLowerCase().endsWith('.txt')) {
      fileType = 'txt';
    }

    // Create file record
    const file = new File({
      userId,
      filename: originalname,
      originalName: originalname,
      type: fileType,
      mimeType: mimetype,
      size,
      s3Key,
      processingStatus: 'pending'
    });

    await file.save();

    // Process file asynchronously
    console.log(`🚀 Starting async processing for file ${file._id} (${fileType})`);
    processFileAsync(file._id, buffer, fileType, userId);

    res.status(201).json({
      message: 'File uploaded successfully',
      file: {
        id: file._id,
        filename: file.filename,
        type: file.type,
        size: file.size,
        uploadedAt: file.uploadedAt
      }
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'File upload failed' });
  }
});

// Get user's files
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const { type, status } = req.query;

    const query = { userId };
    if (type) query.type = type;
    if (status) query.processingStatus = status;

    const files = await File.find(query)
      .sort({ uploadedAt: -1 })
      .select('-s3Key');

    res.json({ files });
  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({ error: 'Failed to retrieve files' });
  }
});

// Get file by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const fileId = req.params.id;

    const file = await File.findOne({ _id: fileId, userId });
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json({ file });
  } catch (error) {
    console.error('Get file error:', error);
    res.status(500).json({ error: 'Failed to retrieve file' });
  }
});

// Delete file
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const fileId = req.params.id;

    const file = await File.findOneAndDelete({ _id: fileId, userId });
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Delete from MinIO
    await fileService.deleteFile(file.s3Key);

    // Delete associated transactions
    await Transaction.deleteMany({ fileId, userId });

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Async file processing function
async function processFileAsync(fileId, buffer, fileType, userId) {
  try {
    console.log(`🔄 Processing file ${fileId} (${fileType}) for user ${userId}`);

    const file = await File.findById(fileId);
    if (!file) {
      console.log(`❌ File ${fileId} not found`);
      return;
    }

    console.log(`📝 Updating file status to processing...`);
    file.processingStatus = 'processing';
    await file.save();

    let parsedData;
    console.log(`📊 Parsing ${fileType} file: ${file.filename}`);

    // Parse file based on type
    if (file.mimeType.includes('spreadsheet') || file.filename.match(/\.(xlsx|xls)$/i)) {
      console.log(`📊 File is Excel format, parsing...`);
      const sheets = await fileService.parseExcelFile(buffer);
      parsedData = sheets[0]?.data || []; // Use first sheet
      console.log(`📊 Parsed ${sheets.length} sheets, first sheet has ${parsedData.length} rows`);
    } else if (file.filename.match(/\.csv$/i)) {
      console.log(`📊 File is CSV format, parsing...`);
      parsedData = await fileService.parseCsvFile(buffer);
      console.log(`📊 Parsed ${parsedData.length} CSV rows`);
    } else if (file.filename.match(/\.pdf$/i)) {
      console.log(`📊 File is PDF format, attempting to parse...`);
      // Note: PDF parsing is currently not implemented - would need pdf-parse library
      // For now, return empty array and mark as unsupported
      parsedData = await fileService.parsePdfFile(buffer);
      if (parsedData.length === 0) {
        console.log(`⚠️ PDF parsing not implemented yet - PDF files are not supported`);
      } else {
        console.log(`📊 Parsed ${parsedData.length} PDF rows`);
      }
    } else {
      console.log(`❌ Unsupported file format`);
      parsedData = [];
    }

    if (parsedData.length === 0) {
      console.log(`⚠️ No data parsed from file`);
      file.processingStatus = 'failed';
      file.processingError = 'No data found in file';
      await file.save();
      return;
    }

    // Process transactions
    console.log(`⚙️ Processing ${fileType} transactions...`);
    let transactions = [];
    if (fileType === 'fuerza_movil') {
      console.log(`⚙️ Processing Fuerza Movil data with ${parsedData.length} rows`);
      transactions = await transactionService.processFuerzaMovilData(parsedData, userId, fileId);
    } else if (fileType === 'bank' || fileType === 'pdf') {
      // Handle both 'bank' and 'pdf' types as bank transactions
      // (PDF files detected as bank statements should be processed as bank)
      console.log(`⚙️ Processing Bank data with ${parsedData.length} rows`);
      transactions = await transactionService.processBankData(parsedData, userId, fileId);
    } else {
      console.log(`❌ Unknown file type: ${fileType}`);
      transactions = [];
    }

    console.log(`💾 Generated ${transactions.length} transactions`);

    // Save transactions
    if (transactions.length > 0) {
      console.log(`💾 Saving transactions to database...`);
      await transactionService.saveTransactions(transactions);
      console.log(`✅ Transactions saved successfully`);
    } else {
      console.log(`⚠️ No transactions to save`);
    }

    // Update file status
    console.log(`✅ Updating file status to completed`);
    file.processingStatus = 'completed';
    file.transactionCount = transactions.length;
    await file.save();

    console.log(`🎉 Successfully processed file ${fileId}: ${transactions.length} transactions`);
  } catch (error) {
    console.error(`❌ Error processing file ${fileId}:`, error);
    console.error(`❌ Error stack:`, error.stack);

    const file = await File.findById(fileId);
    if (file) {
      file.processingStatus = 'failed';
      file.processingError = error.message;
      await file.save();
      console.log(`💥 Updated file ${fileId} status to failed`);
    }
  }
}

module.exports = router;