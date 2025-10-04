const Transaction = require('../models/Transaction');
const Match = require('../models/Match');
const axios = require('axios');

class TransactionService {
  constructor() {
    this.mlServiceUrl = process.env.ML_SERVICE_URL || 'http://ml:5000';
  }

  async processFuerzaMovilData(rows, userId, fileId) {
    const transactions = [];

    // Skip header row
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 10) continue;

      // Debug logging
      console.log(`Processing row ${i}:`, { row0: row[0], rowLength: row.length });

      const reference = (row[0] && row[0].toString().trim()) || `FM-${Date.now()}-${i}`;
      console.log(`Generated reference:`, reference);

      const transaction = {
        fileId,
        userId,
        type: 'fuerza_movil',
        reference: reference, // Nro. de recibo or generated reference
        amount: this.parseAmount(row[6]), // Total Nota
        date: this.parseDate(row[5]), // Fecha de Vencimiento
        description: `Pago ${row[1]} - ${row[2]}`, // Cod Cliente - Cliente
        clientCode: row[1],
        clientName: row[2],
        invoiceNumber: row[3],
        dueDate: this.parseDate(row[5]),
        totalAmount: this.parseAmount(row[6]),
        bank: row[7],
        paymentDate: this.parseDate(row[8]),
        paymentReference: row[9],
        paidAmount: this.parseAmount(row[10]),
        paymentMethod: row[11],
        receiptNotes: row[12],
        receiptStatus: row[13]
      };

      transactions.push(transaction);
    }

    return transactions;
  }

  async processBankData(rows, userId, fileId) {
    const transactions = [];

    // Skip header row
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 4) continue;

      // Debug logging
      console.log(`Processing bank row ${i}:`, { row1: row[1], rowLength: row.length });

      const reference = (row[1] && row[1].toString().trim()) || `BANK-${Date.now()}-${i}`;
      console.log(`Generated bank reference:`, reference);

      const transaction = {
        fileId,
        userId,
        type: 'bank',
        reference: reference, // Referencia or generated reference
        amount: this.parseAmount(row[3]), // Monto
        date: this.parseDate(row[0]), // Fecha
        description: row[2] || '', // Descripción
        balance: this.parseAmount(row[4]), // Balance
        transactionType: this.determineTransactionType(row[2])
      };

      transactions.push(transaction);
    }

    return transactions;
  }

  async saveTransactions(transactions) {
    if (transactions.length === 0) return [];

    // Generate embeddings for descriptions
    const descriptions = transactions.map(t => t.description);
    const embeddings = await this.generateEmbeddings(descriptions);

    // Add embeddings to transactions
    transactions.forEach((transaction, index) => {
      transaction.embedding = embeddings[index] || [];
    });

    const savedTransactions = await Transaction.insertMany(transactions);
    return savedTransactions;
  }

  async generateEmbeddings(texts) {
    try {
      const response = await axios.post(`${this.mlServiceUrl}/embeddings`, {
        texts
      });
      return response.data.embeddings;
    } catch (error) {
      console.error('Error generating embeddings:', error);
      return texts.map(() => []); // Return empty arrays on error
    }
  }

  async findMatches(userId, fuerzaTransactions, bankTransactions) {
    const matches = [];

    for (const fuerzaTx of fuerzaTransactions) {
      for (const bankTx of bankTransactions) {
        const match = await this.calculateMatch(fuerzaTx, bankTx);
        if (match.confidence > 0.1) { // Minimum confidence threshold
          matches.push({
            userId,
            fuerzaTransactionId: fuerzaTx._id,
            bankTransactionId: bankTx._id,
            ...match
          });
        }
      }
    }

    // Sort by confidence and save top matches
    matches.sort((a, b) => b.confidence - a.confidence);

    // Remove duplicate matches (same bank transaction matched to multiple fuerza)
    const uniqueMatches = this.removeDuplicateMatches(matches);

    if (uniqueMatches.length > 0) {
      await Match.insertMany(uniqueMatches);
    }

    return uniqueMatches;
  }

  async calculateMatch(fuerzaTx, bankTx) {
    let confidence = 0;
    const criteria = {
      referenceMatch: false,
      amountMatch: false,
      dateMatch: false,
      embeddingSimilarity: 0
    };

    // Reference matching (exact or partial)
    if (fuerzaTx.reference && bankTx.reference) {
      if (fuerzaTx.reference === bankTx.reference) {
        confidence += 0.4;
        criteria.referenceMatch = true;
      } else if (bankTx.reference.includes(fuerzaTx.reference) ||
                 fuerzaTx.reference.includes(bankTx.reference)) {
        confidence += 0.2;
        criteria.referenceMatch = true;
      }
    }

    // Amount matching (with tolerance)
    const amountDiff = Math.abs(fuerzaTx.amount - bankTx.amount);
    const amountTolerance = Math.max(fuerzaTx.amount * 0.05, 1); // 5% or $1 minimum

    if (amountDiff <= amountTolerance) {
      confidence += 0.3;
      criteria.amountMatch = true;
    } else if (amountDiff <= amountTolerance * 2) {
      confidence += 0.15; // Partial credit for close amounts
    }

    // Date matching (within 3 days)
    const dateDiff = Math.abs(fuerzaTx.date - bankTx.date) / (1000 * 60 * 60 * 24);
    if (dateDiff <= 3) {
      confidence += 0.2;
      criteria.dateMatch = true;
    } else if (dateDiff <= 7) {
      confidence += 0.1;
    }

    // Embedding similarity
    if (fuerzaTx.embedding && bankTx.embedding && fuerzaTx.embedding.length > 0 && bankTx.embedding.length > 0) {
      try {
        const similarity = await this.calculateEmbeddingSimilarity(fuerzaTx.embedding, bankTx.embedding);
        criteria.embeddingSimilarity = similarity;
        if (similarity > 0.8) {
          confidence += 0.3;
        } else if (similarity > 0.6) {
          confidence += 0.15;
        }
      } catch (error) {
        console.error('Error calculating embedding similarity:', error);
      }
    }

    // Determine match type
    let matchType = 'embedding';
    if (criteria.referenceMatch && criteria.amountMatch) {
      matchType = 'exact';
    } else if (criteria.referenceMatch) {
      matchType = 'reference';
    } else if (criteria.amountMatch) {
      matchType = 'amount';
    }

    return {
      confidence: Math.min(confidence, 1),
      matchType,
      criteria,
      amountDifference: amountDiff / fuerzaTx.amount,
      dateDifference: dateDiff
    };
  }

  async calculateEmbeddingSimilarity(embedding1, embedding2) {
    try {
      const response = await axios.post(`${this.mlServiceUrl}/similarity`, {
        embedding1,
        embedding2
      });
      return response.data.similarity;
    } catch (error) {
      console.error('Error calculating similarity:', error);
      return 0;
    }
  }

  removeDuplicateMatches(matches) {
    const seen = new Set();
    return matches.filter(match => {
      // Create unique key for the combination of userId, fuerzaTransactionId, and bankTransactionId
      const key = `${match.userId.toString()}-${match.fuerzaTransactionId.toString()}-${match.bankTransactionId.toString()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  parseDate(dateStr) {
    if (!dateStr) return new Date();

    // Handle different date formats
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? new Date() : date;
  }

  parseAmount(amountStr) {
    if (!amountStr) return 0;

    // Remove currency symbols and convert to number
    const cleaned = amountStr.toString().replace(/[^\d.,-]/g, '').replace(',', '');
    return parseFloat(cleaned) || 0;
  }

  determineTransactionType(description) {
    if (!description) return 'unknown';

    const desc = description.toLowerCase();

    if (desc.includes('pago') || desc.includes('transferencia') || desc.includes('deposito')) {
      return 'credit';
    } else if (desc.includes('compra') || desc.includes('cargo') || desc.includes('debito')) {
      return 'debit';
    }

    return 'unknown';
  }
}

module.exports = new TransactionService();