const xlsx = require('xlsx');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const Minio = require('minio');
const pdf = require('pdf-parse');

class FileService {
  constructor() {
    this.minioClient = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT) || 9000,
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY || 'admin',
      secretKey: process.env.MINIO_SECRET_KEY || 'password'
    });

    this.bucketName = 'bank-reconciliation-files';
    this.initBucket();
  }

  async initBucket() {
    try {
      const exists = await this.minioClient.bucketExists(this.bucketName);
      if (!exists) {
        await this.minioClient.makeBucket(this.bucketName);
      }
    } catch (error) {
      console.error('Error initializing MinIO bucket:', error);
    }
  }

  async uploadFile(userId, fileBuffer, originalName, mimeType) {
    const fileId = `${userId}/${Date.now()}-${originalName}`;
    const metaData = {
      'Content-Type': mimeType,
      'user-id': userId
    };

    await this.minioClient.putObject(this.bucketName, fileId, fileBuffer, metaData);

    return {
      s3Key: fileId,
      size: fileBuffer.length
    };
  }

  async downloadFile(s3Key) {
    const stream = await this.minioClient.getObject(this.bucketName, s3Key);
    return new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  async deleteFile(s3Key) {
    await this.minioClient.removeObject(this.bucketName, s3Key);
  }

  detectFileType(filename) {
    const ext = path.extname(filename).toLowerCase();

    if (['.xlsx', '.xls'].includes(ext)) {
      return 'excel';
    } else if (ext === '.csv') {
      return 'csv';
    } else if (ext === '.pdf') {
      return 'pdf';
    }

    // Check filename for Fuerza Movil pattern
    if (filename.toLowerCase().includes('fuerza') && filename.toLowerCase().includes('movil')) {
      return 'fuerza_movil';
    }

    return 'unknown';
  }

  async parseExcelFile(buffer) {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const results = [];

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

      // Skip empty sheets
      if (jsonData.length === 0) continue;

      results.push({
        sheetName,
        data: jsonData
      });
    }

    return results;
  }

  async parseCsvFile(buffer) {
    return new Promise((resolve, reject) => {
      const results = [];
      const stream = Readable.from(buffer.toString());

      stream
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', reject);
    });
  }

  async parsePdfFile(buffer) {
    try {
      console.log('📄 Extracting text from PDF...');
      const data = await pdf(buffer);
      const text = data.text;
      
      if (!text || text.trim().length === 0) {
        console.log('⚠️ No text content found in PDF');
        return [];
      }

      console.log(`📄 Extracted ${text.length} characters from PDF`);
      
      // Parse PDF text to extract transactions
      // Expected format: date reference description amount [balance]
      // Example: "18/06 00020576 TRANSFERENCIA RECIBIDA DESDE LA CUENTA ***902 1 POR BS. 37,831.39"
      const transactions = this.parsePdfTransactions(text);
      
      console.log(`📊 Parsed ${transactions.length} transactions from PDF`);
      return transactions;
    } catch (error) {
      console.error('❌ Error parsing PDF:', error);
      return [];
    }
  }

  parsePdfTransactions(text) {
    const transactions = [];
    const lines = text.split(/\n/);
    
    // Patterns to identify transaction lines
    // Looking for: date (DD/MM or DD/MM/YY) followed by reference number and description
    const datePattern = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/;
    const referencePattern = /(\d{4,15})/; // 4-15 digit reference numbers
    // Improved amount pattern: handles both US format (37,831.39) and European format (37.831,39)
    const amountPatternUS = /(?:BS\.?|RD\$|USD|€|£|POR\s+BS\.?)?\s*([\d]{1,3}(?:,\d{3})*\.\d{2})/i; // US: 37,831.39
    const amountPatternEU = /(?:BS\.?|RD\$|USD|€|£|POR\s+BS\.?)?\s*([\d]{1,3}(?:\.\d{3})*,\d{2})/i; // EU: 37.831,39
    const amountPatternSimple = /(?:BS\.?|RD\$|USD|€|£|POR\s+BS\.?)?\s*(\d+\.\d{2})/i; // Simple: 37831.39
    
    let currentTransaction = null;
    let currentTransactionLines = []; // Store all lines for multi-line transactions
    let headerRow = ['Fecha', 'Referencia', 'Descripción', 'Monto', 'Balance']; // Header
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length < 5) continue; // Skip very short lines (reduced threshold)
      
      // Check if line starts with a date pattern
      const dateMatch = line.match(/^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
      if (dateMatch) {
        // Save previous transaction if exists
        if (currentTransaction) {
          transactions.push(currentTransaction);
        }
        
        // Start new transaction
        const dateStr = dateMatch[1];
        currentTransactionLines = [line]; // Start collecting lines for this transaction
        
        // Find reference number (usually right after date, separated by space)
        // Pattern: "18/06 00020576" - reference is the long number after date
        const afterDate = line.substring(dateMatch[0].length).trim();
        
        // Look for reference: 4-15 digits, might have leading zeros
        const refMatch = afterDate.match(/^(\d{4,15})/);
        let reference = '';
        let afterRef = afterDate;
        
        if (refMatch) {
          reference = refMatch[1];
          afterRef = afterDate.substring(refMatch[0].length).trim();
        } else {
          // Try to find reference anywhere in the first part
          const refMatchAny = afterDate.match(/(\d{4,15})/);
          if (refMatchAny) {
            reference = refMatchAny[1];
          }
        }
        
        // Look for amount in this line or we'll search in subsequent lines
        let amount = '';
        let amountMatchUS = line.match(amountPatternUS);
        let amountMatchEU = line.match(amountPatternEU);
        let amountMatchSimple = line.match(amountPatternSimple);
        
        if (amountMatchUS) {
          // US format: 37,831.39 -> 37831.39
          amount = amountMatchUS[1].replace(/,/g, '');
        } else if (amountMatchEU) {
          // European format: 37.831,39 -> 37831.39
          amount = amountMatchEU[1].replace(/\./g, '').replace(',', '.');
        } else if (amountMatchSimple) {
          amount = amountMatchSimple[1];
        }
        
        // Description starts after reference
        let description = afterRef;
        
        // Create transaction row: [date, reference, description, amount, balance]
        currentTransaction = [
          dateStr,
          reference,
          description.substring(0, 200),
          amount || '0',
          ''
        ];
      } else if (currentTransaction) {
        // Continue building transaction - this is a continuation line
        currentTransactionLines.push(line);
        
        // Look for amount in continuation lines (amount might be on 2nd or 3rd line)
        if (!currentTransaction[3] || currentTransaction[3] === '0') {
          let amountMatchUS = line.match(amountPatternUS);
          let amountMatchEU = line.match(amountPatternEU);
          let amountMatchSimple = line.match(amountPatternSimple);
          
          if (amountMatchUS) {
            currentTransaction[3] = amountMatchUS[1].replace(/,/g, '');
          } else if (amountMatchEU) {
            currentTransaction[3] = amountMatchEU[1].replace(/\./g, '').replace(',', '.');
          } else if (amountMatchSimple) {
            currentTransaction[3] = amountMatchSimple[1];
          }
        }
        
        // Continue building description (but don't include if it looks like a new transaction start)
        if (!line.match(/^\d{1,2}\/\d{1,2}/)) {
          const currentDesc = currentTransaction[2];
          const newDesc = (currentDesc + ' ' + line).substring(0, 300);
          currentTransaction[2] = newDesc;
        }
      }
    }
    
    // Save last transaction
    if (currentTransaction) {
      transactions.push(currentTransaction);
    }
    
    // If we found transactions, add header row at the beginning
    if (transactions.length > 0) {
      console.log(`📊 Sample parsed transaction: Date=${transactions[0][0]}, Ref=${transactions[0][1]}, Amount=${transactions[0][3]}`);
      return [headerRow, ...transactions];
    }
    
    // Fallback: try to extract any structured data
    return this.fallbackPdfParsing(text);
  }

  fallbackPdfParsing(text) {
    // Fallback parsing: look for any patterns that look like transactions
    const transactions = [];
    const headerRow = ['Fecha', 'Referencia', 'Descripción', 'Monto', 'Balance'];
    
    // Look for lines with dates and amounts
    const lines = text.split(/\n/);
    const dateAmountPattern = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(\d{4,15})?\s*(.*?)\s+([\d.,]+\.\d{2})/;
    
    for (const line of lines) {
      const match = line.match(dateAmountPattern);
      if (match) {
        const [, date, reference = '', description = '', amount = '0'] = match;
        transactions.push([
          date,
          reference,
          description.trim().substring(0, 200),
          amount.replace(/,/g, ''),
          ''
        ]);
      }
    }
    
    if (transactions.length > 0) {
      return [headerRow, ...transactions];
    }
    
    return [];
  }

  determineTransactionType(filename, content) {
    const filenameLower = filename.toLowerCase();

    // Check for Fuerza Movil indicators
    if (filenameLower.includes('fuerza') && filenameLower.includes('movil')) {
      return 'fuerza_movil';
    }

    // Check for bank indicators
    if (filenameLower.includes('banco') || filenameLower.includes('movimiento') ||
        filenameLower.includes('estado') || filenameLower.includes('cuenta')) {
      return 'bank';
    }

    // Check content for Fuerza Movil patterns
    if (content && typeof content === 'string') {
      const contentLower = content.toLowerCase();
      if (contentLower.includes('cod cliente') || contentLower.includes('cliente') ||
          contentLower.includes('nota') || contentLower.includes('recibo')) {
        return 'fuerza_movil';
      }
    }

    return 'unknown';
  }
}

module.exports = new FileService();