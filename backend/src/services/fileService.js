const xlsx = require('xlsx');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const Minio = require('minio');

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
    // Placeholder for PDF parsing - would need pdf-parse library
    // For now, return empty array
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