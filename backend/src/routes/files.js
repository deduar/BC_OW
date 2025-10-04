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
    const fileType = fileService.determineTransactionType(originalname, buffer.toString());

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
    const file = await File.findById(fileId);
    if (!file) return;

    file.processingStatus = 'processing';
    await file.save();

    let parsedData;

    // Parse file based on type
    if (file.mimeType.includes('spreadsheet') || file.filename.match(/\.(xlsx|xls)$/i)) {
      const sheets = await fileService.parseExcelFile(buffer);
      parsedData = sheets[0]?.data || []; // Use first sheet
    } else if (file.filename.match(/\.csv$/i)) {
      parsedData = await fileService.parseCsvFile(buffer);
    } else {
      parsedData = [];
    }

    // Process transactions
    let transactions = [];
    if (fileType === 'fuerza_movil') {
      transactions = await transactionService.processFuerzaMovilData(parsedData, userId, fileId);
    } else if (fileType === 'bank') {
      transactions = await transactionService.processBankData(parsedData, userId, fileId);
    }

    // Save transactions
    if (transactions.length > 0) {
      await transactionService.saveTransactions(transactions);
    }

    // Update file status
    file.processingStatus = 'completed';
    file.transactionCount = transactions.length;
    await file.save();

    console.log(`Processed file ${fileId}: ${transactions.length} transactions`);
  } catch (error) {
    console.error(`Error processing file ${fileId}:`, error);

    const file = await File.findById(fileId);
    if (file) {
      file.processingStatus = 'failed';
      file.processingError = error.message;
      await file.save();
    }
  }
}

module.exports = router;