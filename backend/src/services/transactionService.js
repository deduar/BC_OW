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

    console.log(`Saving ${transactions.length} transactions...`);

    try {
      // Generate embeddings for descriptions
      const descriptions = transactions.map(t => t.description);
      console.log('Generating embeddings...');
      const embeddings = await this.generateEmbeddings(descriptions);
      console.log(`Generated ${embeddings.length} embeddings`);

      // Add embeddings to transactions
      transactions.forEach((transaction, index) => {
        transaction.embedding = embeddings[index] || [];
      });

      console.log('Inserting transactions into database...');
      const savedTransactions = await Transaction.insertMany(transactions);
      console.log(`Successfully saved ${savedTransactions.length} transactions`);
      return savedTransactions;
    } catch (error) {
      console.error('Error saving transactions:', error);
      throw error;
    }
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
    let totalComparisons = 0;
    let referenceMatches = 0;

    console.log(`🔍 Starting match process for user ${userId}`);
    console.log(`📊 Processing: ${fuerzaTransactions.length} Fuerza Movil transactions vs ${bankTransactions.length} bank transactions`);

    if (fuerzaTransactions.length === 0 || bankTransactions.length === 0) {
      console.warn('⚠️ No transactions to match');
      return [];
    }

    console.log(`📋 Fuerza transactions IDs: ${fuerzaTransactions.map(t => t._id).slice(0, 5)}${fuerzaTransactions.length > 5 ? '...' : ''}`);
    console.log(`🏦 Bank transactions IDs: ${bankTransactions.map(t => t._id).slice(0, 5)}${bankTransactions.length > 5 ? '...' : ''}`);

    for (const fuerzaTx of fuerzaTransactions) {
      for (const bankTx of bankTransactions) {
        totalComparisons++;
        const match = await this.calculateMatch(fuerzaTx, bankTx);
        
        // Log reference matches for debugging
        if (match.criteria.referenceMatch) {
          referenceMatches++;
          console.log(`Reference match found: FM "${fuerzaTx.reference}" <-> Bank "${bankTx.reference}" (confidence: ${match.confidence.toFixed(3)}, type: ${match.criteria.referenceMatch})`);
        }

        // Apply balanced filtering to avoid false positives while allowing valid matches
        if (match.confidence > 0.1 && this.isValidMatch(match, fuerzaTx, bankTx)) {
          console.log(`Creating match: FM ${fuerzaTx._id} <-> Bank ${bankTx._id} (confidence: ${match.confidence.toFixed(3)})`);
          matches.push({
            userId,
            fuerzaTransactionId: fuerzaTx._id,
            bankTransactionId: bankTx._id,
            ...match
          });
        }
      }
    }

    console.log(`📊 Match process completed: ${totalComparisons} comparisons, ${referenceMatches} reference matches, ${matches.length} total matches above threshold`);

    if (matches.length === 0) {
      console.log('⚠️ No matches found above threshold');
      return [];
    }

    // Remove duplicate matches (bank transactions can only be used once)
    console.log('🔄 Removing duplicate matches...');
    const uniqueMatches = this.removeDuplicateMatches(matches);

    console.log(`✅ After deduplication: ${uniqueMatches.length} unique matches`);

    if (uniqueMatches.length > 0) {
      console.log('💾 Saving matches to database...');
      try {
        await Match.insertMany(uniqueMatches);
        console.log(`✅ Successfully saved ${uniqueMatches.length} matches to database`);
      } catch (dbError) {
        console.error('❌ Error saving matches to database:', dbError);
        throw new Error(`Failed to save matches: ${dbError.message}`);
      }
    }

    return uniqueMatches;
  }

  async calculateMatch(fuerzaTx, bankTx) {
    console.log(`\n=== Starting match calculation ===`);
    console.log(`Fuerza Tx ID: ${fuerzaTx._id}, Ref: "${fuerzaTx.reference}", Amount: ${fuerzaTx.amount}, Date: ${fuerzaTx.date}`);
    console.log(`Bank Tx ID: ${bankTx._id}, Ref: "${bankTx.reference}", Amount: ${bankTx.amount}, Date: ${bankTx.date}`);
    console.log(`Fuerza paymentDate: ${fuerzaTx.paymentDate}, totalAmount: ${fuerzaTx.totalAmount}, paidAmount: ${fuerzaTx.paidAmount}`);

    let confidence = 0;
    const criteria = {
      referenceMatch: false,
      amountMatch: false,
      dateMatch: false,
      bankNameMatch: false,
      embeddingSimilarity: 0
    };

    // Reference matching with regex patterns for Fuerza Movil
    // PRIORITIZE EMBEDDED REFERENCES - This is the most important criterion
    console.log(`\n--- Reference Matching (PRIORITY CRITERION) ---`);
    console.log(`Fuerza paymentReference: "${fuerzaTx.paymentReference}"`);
    console.log(`Fuerza main reference: "${fuerzaTx.reference}"`);
    console.log(`Bank reference: "${bankTx.reference}"`);

    let referenceMatch = null;

    // First, try paymentReference (most specific) - HIGHEST PRIORITY
    if (fuerzaTx.paymentReference && bankTx.reference) {
      console.log(`🔍 Trying paymentReference: "${fuerzaTx.paymentReference}" vs "${bankTx.reference}"`);
      referenceMatch = this.matchReferences(fuerzaTx.paymentReference, bankTx.reference);
      console.log(`PaymentReference match result:`, referenceMatch);
      if (referenceMatch.matched) {
        // SIGNIFICANTLY INCREASE confidence for embedded references
        const enhancedConfidence = referenceMatch.confidence * 2.5; // Boost by 2.5x
        confidence += enhancedConfidence;
        criteria.referenceMatch = referenceMatch.type;
        console.log(`✅ PaymentReference EMBEDDED MATCH! Confidence: +${enhancedConfidence.toFixed(3)} (boosted)`);
      }
    }
    
    // If no match with paymentReference, try main reference - SECOND PRIORITY
    if ((!referenceMatch || !referenceMatch.matched) && fuerzaTx.reference && bankTx.reference) {
      console.log(`🔍 Trying main reference: "${fuerzaTx.reference}" vs "${bankTx.reference}"`);
      referenceMatch = this.matchReferences(fuerzaTx.reference, bankTx.reference);
      console.log(`Main reference match result:`, referenceMatch);
      if (referenceMatch.matched) {
        // Boost confidence for main reference matches too
        const enhancedConfidence = referenceMatch.confidence * 2.0; // Boost by 2x
        confidence += enhancedConfidence;
        criteria.referenceMatch = referenceMatch.type;
        console.log(`✅ Main Reference EMBEDDED MATCH! Confidence: +${enhancedConfidence.toFixed(3)} (boosted)`);
      }
    }
    
    // If still no match, try extracting numbers from description
    if ((!referenceMatch || !referenceMatch.matched) && fuerzaTx.description && bankTx.reference) {
      const descNumbers = fuerzaTx.description.match(/\d{4,}/g); // Extract numbers with 4+ digits
      if (descNumbers) {
        for (const num of descNumbers) {
          referenceMatch = this.matchReferences(num, bankTx.reference);
          if (referenceMatch.matched) {
            confidence += referenceMatch.confidence;
            criteria.referenceMatch = referenceMatch.type;
            break;
          }
        }
      }
    }

    // Bank name matching
    if (fuerzaTx.bank && bankTx.description) {
      const bankNameMatch = this.matchBankNames(fuerzaTx.bank, bankTx.description);
      if (bankNameMatch.matched) {
        confidence += bankNameMatch.confidence;
        criteria.bankNameMatch = true;
      }
    }

    // Amount matching (with tolerance) - REDUCED WEIGHT since reference is priority
    // Only used as secondary validation, not primary criterion
    console.log(`\n--- Amount Matching (SECONDARY CRITERION) ---`);
    console.log(`Bank amount: ${bankTx.amount}`);

    const fuerzaAmounts = [
      fuerzaTx.paidAmount || fuerzaTx.amount, // Current logic
      fuerzaTx.totalAmount, // Total amount from invoice
      fuerzaTx.amount // Fallback to main amount
    ].filter(amount => amount && amount > 0);

    console.log(`Fuerza amounts to try: [${fuerzaAmounts.join(', ')}]`);

    let bestAmountMatch = { diff: Infinity, confidence: 0, matched: false };
    let amountDiff = 0; // Initialize amountDiff variable

    for (const fuerzaAmount of fuerzaAmounts) {
      amountDiff = Math.abs(fuerzaAmount - bankTx.amount);
      const amountTolerance = Math.max(fuerzaAmount * 0.05, 1); // 5% or $1 minimum

      if (amountDiff <= amountTolerance) {
        bestAmountMatch = { diff: amountDiff, confidence: 0.1, matched: true }; // Reduced weight
        break; // Exact match found, use it
      } else if (amountDiff <= amountTolerance * 2 && amountDiff < bestAmountMatch.diff) {
        bestAmountMatch = { diff: amountDiff, confidence: 0.05, matched: true }; // Reduced weight
      } else if (amountDiff <= amountTolerance * 5 && amountDiff < bestAmountMatch.diff) {
        bestAmountMatch = { diff: amountDiff, confidence: 0.02, matched: true }; // Reduced weight
      }
    }

    if (bestAmountMatch.matched) {
      confidence += bestAmountMatch.confidence;
      criteria.amountMatch = true;
    }

    // Date matching (within 3 days) - MINIMAL WEIGHT since reference is priority
    // Only used as very secondary validation
    console.log(`\n--- Date Matching (TERTIARY CRITERION) ---`);
    const fuerzaDate = fuerzaTx.paymentDate || fuerzaTx.date || fuerzaTx.dueDate;
    const dateDiff = Math.abs(fuerzaDate - bankTx.date) / (1000 * 60 * 60 * 24);
    if (dateDiff <= 3) {
      confidence += 0.02; // Minimal weight
      criteria.dateMatch = true;
    } else if (dateDiff <= 7) {
      confidence += 0.01; // Minimal weight
    }

    // Embedding similarity (description matching) - MINIMAL WEIGHT
    if (fuerzaTx.embedding && bankTx.embedding && fuerzaTx.embedding.length > 0 && bankTx.embedding.length > 0) {
      try {
        const similarity = await this.calculateEmbeddingSimilarity(fuerzaTx.embedding, bankTx.embedding);
        criteria.embeddingSimilarity = similarity;
        if (similarity > 0.85) {
          confidence += 0.05; // Very minimal weight
        } else if (similarity > 0.7) {
          confidence += 0.03; // Very minimal weight
        } else if (similarity > 0.5) {
          confidence += 0.01; // Very minimal weight
        }
      } catch (error) {
        console.error('Error calculating embedding similarity:', error);
      }
    }

    // Determine match type based on strongest criteria
    let matchType = 'embedding';
    if (criteria.referenceMatch && criteria.amountMatch) {
      matchType = 'exact';
    } else if (criteria.referenceMatch && criteria.embeddingSimilarity > 0.7) {
      matchType = 'reference_description';
    } else if (criteria.amountMatch && criteria.embeddingSimilarity > 0.7) {
      matchType = 'amount_description';
    } else if (criteria.referenceMatch) {
      matchType = 'reference';
    } else if (criteria.amountMatch) {
      matchType = 'amount';
    } else if (criteria.embeddingSimilarity > 0.8) {
      matchType = 'description';
    } else if (criteria.bankNameMatch) {
      matchType = 'bank_name';
    }

    // Calculate final amount difference using the best matching amounts
    const finalFuerzaAmount = fuerzaAmounts.length > 0 ? fuerzaAmounts[0] : (fuerzaTx.paidAmount || fuerzaTx.amount);
    const amountDifference = bestAmountMatch.matched ? bestAmountMatch.diff / finalFuerzaAmount : (amountDiff || 0) / finalFuerzaAmount;

    console.log(`\n=== Match Result ===`);
    console.log(`Final confidence: ${confidence.toFixed(3)}`);
    console.log(`Match type: ${matchType}`);
    console.log(`Criteria met:`, criteria);
    console.log(`Amount difference: ${(amountDifference * 100).toFixed(1)}%`);
    console.log(`Date difference: ${dateDiff.toFixed(1)} days`);
    console.log(`Will match: ${confidence > 0.1 ? 'YES' : 'NO'}`);

    return {
      confidence: Math.min(confidence, 1),
      matchType,
      criteria,
      amountDifference,
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

  // Helper function to check for consecutive digits
  hasConsecutiveDigits(fuerzaNumbers, bankNumbers, minLength = 5) {
    if (fuerzaNumbers.length < minLength || bankNumbers.length < minLength) {
      return false;
    }

    // Check if fuerzaNumbers appears as consecutive digits in bankNumbers
    return bankNumbers.includes(fuerzaNumbers);
  }

  matchReferences(fuerzaReference, bankReference) {
    // Clean references for comparison
    const cleanFuerzaRef = fuerzaReference.toString().trim().toUpperCase();
    const cleanBankRef = bankReference.toString().trim().toUpperCase();

    // Exact match
    if (cleanFuerzaRef === cleanBankRef) {
      return { matched: true, confidence: 0.95, type: 'exact' }; // Very high confidence
    }

    // Extract numeric parts from both references
    const fuerzaNumbers = cleanFuerzaRef.replace(/[^\d]/g, '');
    const bankNumbers = cleanBankRef.replace(/[^\d]/g, '');

    console.log(`🔢 Comparing numbers: Fuerza "${fuerzaNumbers}" vs Bank "${bankNumbers}"`);

    // STRICT EMBEDDED REFERENCE VALIDATION
    // CRITICAL REQUIREMENT: At least 5 consecutive digits must match
    if (fuerzaNumbers.length >= 5 && bankNumbers.length >= 8) {
      // Check if bank reference ends with Fuerza reference (most reliable)
      if (bankNumbers.endsWith(fuerzaNumbers)) {
        console.log(`✅ STRICT EMBEDDED MATCH (ENDS WITH): ${fuerzaNumbers} at end of ${bankNumbers}`);
        return { matched: true, confidence: 0.95, type: 'embedded_payment_ref' }; // Maximum confidence
      }

      // Check if bank reference contains Fuerza reference with STRICT validation
      if (bankNumbers.includes(fuerzaNumbers) && this.hasConsecutiveDigits(fuerzaNumbers, bankNumbers, 5)) {
        console.log(`✅ STRICT EMBEDDED MATCH (CONTAINS): ${fuerzaNumbers} found in ${bankNumbers}`);

        // MUCH HIGHER confidence for embedded matches
        let confidence = 0.85; // Base very high confidence for embedded matches

        if (fuerzaNumbers.length >= 7) confidence = 0.9;
        else if (fuerzaNumbers.length >= 6) confidence = 0.88;
        else if (fuerzaNumbers.length >= 5) confidence = 0.85;

        return { matched: true, confidence, type: 'embedded_numeric_match' };
      }

      // Check for Fuerza reference within bank reference with position-based confidence
      const fuerzaInBank = bankNumbers.indexOf(fuerzaNumbers);
      if (fuerzaInBank !== -1 && this.hasConsecutiveDigits(fuerzaNumbers, bankNumbers, 5)) {
        console.log(`✅ STRICT POSITION MATCH: ${fuerzaNumbers} at position ${fuerzaInBank} in ${bankNumbers}`);
        // Higher confidence if Fuerza reference is at the end (more likely to be payment ref)
        const positionRatio = fuerzaInBank / (bankNumbers.length - fuerzaNumbers.length);
        if (positionRatio > 0.7) { // Near the end
          return { matched: true, confidence: 0.9, type: 'embedded_payment_ref_position' };
        } else if (positionRatio > 0.5) { // In the latter half
          return { matched: true, confidence: 0.85, type: 'embedded_payment_ref_late' };
        } else { // Earlier in the reference
          return { matched: true, confidence: 0.8, type: 'embedded_payment_ref_early' };
        }
      }
    }
    
    // Also check if Fuerza reference contains bank reference (reverse case)
    if (bankNumbers.length >= 4 && fuerzaNumbers.length >= 8) {
      if (fuerzaNumbers.includes(bankNumbers)) {
        return { matched: true, confidence: 0.25, type: 'embedded_reverse_match' };
      }
    }

    // Fuerza Movil specific patterns
    const fuerzaPatterns = [
      // Pattern 1: FM followed by numbers (e.g., FM123456)
      /^FM\d+$/,
      // Pattern 2: Numbers followed by FM (e.g., 123456FM)
      /^\d+FM$/,
      // Pattern 3: FM with separators (e.g., FM-123456, FM_123456)
      /^FM[-_]?\d+$/,
      // Pattern 4: Just numbers (common in Fuerza Movil receipts)
      /^\d{6,12}$/,
      // Pattern 5: FM with date pattern (e.g., FM20250101)
      /^FM\d{8}$/,
      // Pattern 6: Mixed alphanumeric with FM (e.g., FM123ABC)
      /^FM[A-Z0-9]+$/
    ];

    // Bank reference patterns that might contain Fuerza Movil references
    const bankPatterns = [
      // Pattern 1: Bank reference containing FM pattern
      /FM\d+/,
      // Pattern 2: Bank reference with transaction number
      /TRANSACCION\s*:?\s*(\d+)/,
      // Pattern 3: Bank reference with reference number
      /REF\s*:?\s*(\d+)/,
      // Pattern 4: Bank reference with payment reference
      /PAGO\s*:?\s*(\d+)/,
      // Pattern 5: Bank reference with transfer reference
      /TRANSFERENCIA\s*:?\s*(\d+)/,
      // Pattern 6: Bank reference with deposit reference
      /DEPOSITO\s*:?\s*(\d+)/,
      // Pattern 7: Bank reference with transfer code (e.g., TRF.MB 0134)
      /TRF\.\w+\s+\d+/,
      // Pattern 8: Bank reference with account number pattern
      /\d{10,15}/, // Long numeric sequences that might contain payment refs
      // Pattern 9: Open World specific patterns (from the user's example)
      /OPEN\s+WORLD\s+CONSUL\s*\d*/,
      // Pattern 10: J followed by numbers (from J302386900 pattern)
      /J\d+/,
      // Pattern 11: Generic alphanumeric patterns that might contain payment refs
      /[A-Z]+\d+/,
      // Pattern 12: Numbers with specific separators
      /\d{4,}[A-Z]\d{4,}/
    ];

    // Check if Fuerza reference matches any pattern
    const fuerzaMatchesPattern = fuerzaPatterns.some(pattern => pattern.test(cleanFuerzaRef));
    
    if (fuerzaMatchesPattern) {
      // Check if bank reference contains the same numbers
      if (cleanBankRef.includes(fuerzaNumbers) && fuerzaNumbers.length >= 4) {
        return { matched: true, confidence: 0.35, type: 'numeric_match' };
      }

      // Check bank patterns
      for (const pattern of bankPatterns) {
        const match = cleanBankRef.match(pattern);
        if (match) {
          // Extract numbers from the pattern match
          const extractedNumbers = match[1] || match[0].replace(/[^\d]/g, '');

          if (extractedNumbers === fuerzaNumbers ||
              (fuerzaNumbers.includes(extractedNumbers) && extractedNumbers.length >= 4) ||
              (extractedNumbers.includes(fuerzaNumbers) && fuerzaNumbers.length >= 4)) {
            // Higher confidence for longer matches or significant portions
            const matchLength = Math.min(extractedNumbers.length, fuerzaNumbers.length);
            const confidence = matchLength >= 6 ? 0.35 : matchLength >= 5 ? 0.3 : 0.25;
            return { matched: true, confidence, type: 'pattern_match' };
          }

          // Also check if the pattern contains the fuerza numbers anywhere
          if (extractedNumbers.includes(fuerzaNumbers) && fuerzaNumbers.length >= 4) {
            const confidence = fuerzaNumbers.length >= 6 ? 0.3 : 0.25;
            return { matched: true, confidence, type: 'pattern_contains_fuerza' };
          }
        }
      }

      // Partial match - check if bank reference contains significant part of Fuerza reference
      if (fuerzaNumbers.length >= 6) {
        const partialMatch = fuerzaNumbers.substring(0, 6);
        if (cleanBankRef.includes(partialMatch)) {
          return { matched: true, confidence: 0.2, type: 'partial_match' };
        }
      }
    }

    // Fallback to original logic for non-standard references
    if (cleanBankRef.includes(cleanFuerzaRef) || cleanFuerzaRef.includes(cleanBankRef)) {
      return { matched: true, confidence: 0.15, type: 'substring_match' };
    }

    return { matched: false, confidence: 0, type: 'no_match' };
  }

  matchBankNames(fuerzaBank, bankDescription) {
    if (!fuerzaBank || !bankDescription) {
      return { matched: false, confidence: 0, type: 'no_match' };
    }

    const cleanFuerzaBank = fuerzaBank.toString().trim().toUpperCase();
    const cleanBankDesc = bankDescription.toString().trim().toUpperCase();

    // Common bank name mappings
    const bankMappings = {
      'BANESCO': ['BANESCO', 'BCO BANESCO', 'BANCO BANESCO'],
      'VENEZUELA': ['VENEZUELA', 'BANCO DE VENEZUELA', 'BDV'],
      'PROVINCIAL': ['PROVINCIAL', 'BANCO PROVINCIAL', 'BP'],
      'MERCANTIL': ['MERCANTIL', 'BANCO MERCANTIL', 'BM'],
      'BOD': ['BOD', 'BANCO OCCIDENTAL DE DESCUENTO'],
      'BANPLUS': ['BANPLUS', 'BANCO BANPLUS'],
      '100% BANCO': ['100% BANCO', '100%BANCO'],
      'BANCO DEL TESORO': ['BANCO DEL TESORO', 'TESORO'],
      'BANCO NACIONAL DE CREDITO': ['BANCO NACIONAL DE CREDITO', 'BNC']
    };

    // Check exact matches first
    for (const [bankName, variations] of Object.entries(bankMappings)) {
      if (variations.includes(cleanFuerzaBank)) {
        // Check if bank description contains any variation of this bank
        for (const variation of variations) {
          if (cleanBankDesc.includes(variation)) {
            return { matched: true, confidence: 0.25, type: 'bank_name_match' };
          }
        }
      }
    }

    // Check if bank description contains the Fuerza bank name
    if (cleanBankDesc.includes(cleanFuerzaBank)) {
      return { matched: true, confidence: 0.2, type: 'bank_name_substring' };
    }

    // Check if bank description contains any bank name from mappings
    for (const [bankName, variations] of Object.entries(bankMappings)) {
      for (const variation of variations) {
        if (cleanBankDesc.includes(variation) && cleanFuerzaBank.includes(bankName)) {
          return { matched: true, confidence: 0.2, type: 'bank_name_mapping' };
        }
      }
    }

    // Check if Fuerza bank name contains part of bank description
    const bankDescWords = cleanBankDesc.split(/\s+/);
    for (const word of bankDescWords) {
      if (word.length >= 4 && cleanFuerzaBank.includes(word)) {
        return { matched: true, confidence: 0.15, type: 'bank_name_partial' };
      }
    }

    return { matched: false, confidence: 0, type: 'no_match' };
  }

  removeDuplicateMatches(matches) {
    // Rule: Bank transactions can only be used once, but Fuerza Movil transactions can be used multiple times
    const usedBankTransactions = new Set();
    const uniqueMatches = [];

    // Sort matches by confidence (highest first) to prioritize better matches
    const sortedMatches = matches.sort((a, b) => b.confidence - a.confidence);

    for (const match of sortedMatches) {
      if (!match.bankTransactionId) {
        console.log('Skipping match with undefined bankTransactionId');
        continue;
      }
      
      const bankTxId = match.bankTransactionId.toString();
      
      // Check if this bank transaction has already been used
      if (!usedBankTransactions.has(bankTxId)) {
        // Bank transaction is available, add the match
        uniqueMatches.push(match);
        usedBankTransactions.add(bankTxId);
        
        console.log(`Bank transaction ${bankTxId} matched with Fuerza transaction ${match.fuerzaTransactionId} (confidence: ${match.confidence.toFixed(3)})`);
      } else {
        console.log(`Bank transaction ${bankTxId} already used, skipping match with Fuerza transaction ${match.fuerzaTransactionId} (confidence: ${match.confidence.toFixed(3)})`);
      }
    }

    console.log(`Deduplication complete: ${matches.length} total matches -> ${uniqueMatches.length} unique matches`);
    console.log(`Used bank transactions: ${usedBankTransactions.size}/${matches.length} unique bank transactions`);
    
    return uniqueMatches;
  }

  isValidMatch(match, fuerzaTx, bankTx) {
    // CRITICAL: If we have a REFERENCE EMBEDDED match, accept it regardless of other criteria
    if (match.criteria.referenceMatch && match.criteria.referenceMatch.includes('embedded')) {
      console.log(`🎯 ACCEPTING MATCH: Has STRICT embedded reference match (${match.criteria.referenceMatch})`);
      return true;
    }

    // For non-embedded reference matches, be more strict
    if (match.criteria.referenceMatch) {
      console.log(`Accepting match: has reference match, being lenient`);
      return true;
    }

    // Reject matches with extreme amount differences (>95% - very lenient)
    if (match.amountDifference > 0.95) {
      console.log(`Rejecting match: amount difference too high (${(match.amountDifference * 100).toFixed(1)}%)`);
      return false;
    }

    // For matches without embedded references, require higher confidence
    if (match.confidence < 0.7) { // Increased threshold for non-reference matches
      console.log(`Rejecting match: insufficient confidence (${match.confidence.toFixed(3)}) without embedded reference`);
      return false;
    }

    // Reject matches where only bank name matches (more strict)
    if (match.matchType === 'bank_name' && match.confidence < 0.5) {
      console.log(`Rejecting match: bank name only match with low confidence`);
      return false;
    }

    // Reject matches with very different amounts even if other criteria match (very lenient)
    const fuerzaAmount = fuerzaTx.paidAmount || fuerzaTx.amount;
    const bankAmount = bankTx.amount;
    const amountRatio = Math.max(fuerzaAmount, bankAmount) / Math.min(fuerzaAmount, bankAmount);

    if (amountRatio > 50) { // One amount is more than 50x the other (reduced tolerance)
      console.log(`Rejecting match: amount ratio too extreme (${amountRatio.toFixed(1)}x)`);
      return false;
    }

    return true;
  }

  parseDate(dateStr) {
    if (!dateStr) return new Date();

    // Handle different date formats
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? new Date() : date;
  }

  parseAmount(amountStr) {
    if (!amountStr) return 0;

    // Convert to string and clean
    let cleaned = amountStr.toString().trim();
    
    // Remove currency symbols and spaces
    cleaned = cleaned.replace(/[^\d.,-]/g, '');
    
    // Handle different decimal formats
    // Format 1: 6.245,00 (European format with comma as decimal separator)
    if (cleaned.includes(',') && cleaned.includes('.')) {
      // If both comma and dot exist, assume dot is thousands separator and comma is decimal
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    }
    // Format 2: 6,245.00 (US format with comma as thousands separator)
    else if (cleaned.includes(',') && !cleaned.includes('.')) {
      // Check if comma is likely thousands separator (3 digits after comma)
      const parts = cleaned.split(',');
      if (parts.length === 2 && parts[1].length === 3) {
        cleaned = cleaned.replace(',', '');
      } else {
        // Assume comma is decimal separator
        cleaned = cleaned.replace(',', '.');
      }
    }
    // Format 3: 6245.00 or 6245,00 (simple decimal)
    else if (cleaned.includes(',')) {
      cleaned = cleaned.replace(',', '.');
    }
    
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