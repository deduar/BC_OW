const Transaction = require('../models/Transaction');
const Match = require('../models/Match');

class OptimizedTransactionService {
  constructor() {
    // Sin dependencias de ML
  }

  /**
   * Algoritmo optimizado de matching en 3 fases (SIN MACHINE LEARNING)
   * Fase 1: Matching por referencia (prioridad alta)
   * Fase 2: Matching por monto + fecha (solo si no hay referencia)
   * Fase 3: Matching por descripción simple (solo casos especiales)
   */
  async findMatchesOptimized(userId, fuerzaTransactions, bankTransactions) {
    console.log(`Starting optimized matching for ${fuerzaTransactions.length} FuerzaMovil and ${bankTransactions.length} bank transactions`);
    
    const matches = [];
    const usedBankTxIds = new Set();
    const usedFuerzaTxIds = new Set();

    // FASE 1: Matching por referencia (CRITERIO PRINCIPAL)
    console.log('Phase 1: Reference-based matching');
    const referenceMatches = await this.findReferenceMatches(
      fuerzaTransactions, 
      bankTransactions, 
      usedBankTxIds, 
      usedFuerzaTxIds
    );
    matches.push(...referenceMatches);
    console.log(`Phase 1 completed: ${referenceMatches.length} matches found`);

    // FASE 2: Matching por monto + fecha (solo transacciones no emparejadas)
    console.log('Phase 2: Amount + Date matching');
    const remainingFuerza = fuerzaTransactions.filter(tx => !usedFuerzaTxIds.has(tx._id.toString()));
    const remainingBank = bankTransactions.filter(tx => !usedBankTxIds.has(tx._id.toString()));
    
    const amountDateMatches = await this.findAmountDateMatches(
      remainingFuerza, 
      remainingBank, 
      usedBankTxIds, 
      usedFuerzaTxIds
    );
    matches.push(...amountDateMatches);
    console.log(`Phase 2 completed: ${amountDateMatches.length} matches found`);

    // FASE 3: Descripción simple (sin ML)
    console.log('Phase 3: Description-based matching (simple text)');
    const finalFuerza = fuerzaTransactions.filter(tx => !usedFuerzaTxIds.has(tx._id.toString()));
    const finalBank = bankTransactions.filter(tx => !usedBankTxIds.has(tx._id.toString()));
    
    const descriptionMatches = await this.findDescriptionMatches(
      finalFuerza,
      finalBank,
      usedBankTxIds, 
      usedFuerzaTxIds
    );
    matches.push(...descriptionMatches);
    console.log(`Phase 3 completed: ${descriptionMatches.length} matches found`);

    // Preparar matches para guardar
    const matchesToSave = matches.map(match => ({
      userId,
      fuerzaTransactionId: match.fuerzaTransactionId,
      bankTransactionId: match.bankTransactionId,
      confidence: match.confidence,
      matchType: match.matchType,
      criteria: match.criteria,
      amountDifference: match.amountDifference,
      dateDifference: match.dateDifference
    }));

    console.log(`Total matches found: ${matchesToSave.length}`);
    return matchesToSave;
  }

  /**
   * FASE 1: Matching por referencia
   * Lógica: referencia FuerzaMovil debe ser subcadena de referencia bancaria
   */
  async findReferenceMatches(fuerzaTransactions, bankTransactions, usedBankTxIds, usedFuerzaTxIds) {
    const matches = [];
    let debugChecked = 0;
    let debugSkipped = 0;
    let debugNoRef = 0;

    for (const fuerzaTx of fuerzaTransactions) {
      // Try main reference and paymentReference
      const fmMainRef = (fuerzaTx.reference && fuerzaTx.reference.replace(/[^\d]/g, '')) || '';
      const fmPaymentRef = (fuerzaTx.paymentReference && fuerzaTx.paymentReference.toString().replace(/[^\d]/g, '')) || '';
      
      // Need at least one valid reference (4+ digits)
      if ((!fmMainRef || fmMainRef.length < 4) && (!fmPaymentRef || fmPaymentRef.length < 4)) {
        debugNoRef++;
        continue;
      }

      // Buscar transacciones bancarias que contengan la referencia de FuerzaMovil
      // Check multiple matching strategies with both main ref and payment ref
      const candidateBankTxs = bankTransactions.filter(bankTx => {
        if (!bankTx.reference || usedBankTxIds.has(bankTx._id.toString())) {
          return false;
        }
        
        const bankRef = bankTx.reference.replace(/[^\d]/g, '');
        
        // Try matching with main reference
        if (fmMainRef.length >= 4 && this.referencesMatch(fmMainRef, bankRef)) {
          return true;
        }
        
        // Try matching with payment reference (this is often the actual bank payment ref!)
        if (fmPaymentRef.length >= 4 && this.referencesMatch(fmPaymentRef, bankRef)) {
          return true;
        }
        
        return false;
      });

      debugChecked++;
      if (candidateBankTxs.length === 0) {
        debugSkipped++;
        // Log first few failures for debugging
        if (debugSkipped <= 5) {
          console.log(`🔍 No candidates for FM ref: "${fuerzaTx.reference}" (amount: ${fuerzaTx.amount || fuerzaTx.paidAmount})`);
        }
        continue;
      }

      // Para cada candidato, calcular score de matching
      for (const bankTx of candidateBankTxs) {
        const match = this.calculateReferenceMatch(fuerzaTx, bankTx);
        
        // Lower threshold for reference matches - was 0.6, now 0.5
        if (match.confidence >= 0.5) {
          const refUsed = match.criteria.referenceMatch === 'payment_ref' ? fmPaymentRef : fmMainRef;
          console.log(`✅ Match found: FM main:"${fmMainRef}" payment:"${fmPaymentRef}" <-> Bank "${bankTx.reference}" (conf: ${match.confidence.toFixed(2)}, used: ${match.criteria.referenceMatch})`);
          matches.push({
            fuerzaTransactionId: fuerzaTx._id,
            bankTransactionId: bankTx._id,
            ...match
          });
          
          usedBankTxIds.add(bankTx._id.toString());
          usedFuerzaTxIds.add(fuerzaTx._id.toString());
          break; // Solo tomar el primer match por referencia
        } else {
          if (matches.length < 3) {
            console.log(`⚠️ Low confidence match rejected: FM "${fuerzaTx.reference}" <-> Bank "${bankTx.reference}" (conf: ${match.confidence.toFixed(2)})`);
          }
        }
      }
    }

    console.log(`📊 Reference matching stats: ${debugChecked} checked, ${debugSkipped} no candidates, ${debugNoRef} no valid reference`);
    return matches;
  }

  /**
   * FASE 2: Matching por monto + fecha
   * Solo para transacciones sin referencia válida
   */
  async findAmountDateMatches(fuerzaTransactions, bankTransactions, usedBankTxIds, usedFuerzaTxIds) {
    const matches = [];

    for (const fuerzaTx of fuerzaTransactions) {
      // Use paidAmount if available (actual payment amount)
      const fuerzaAmount = fuerzaTx.paidAmount || fuerzaTx.amount;
      if (fuerzaAmount <= 0) continue; // Saltar transacciones sin monto

      // Buscar candidatos por monto (tolerancia más realista)
      // Los montos deben ser muy similares en magnitud pero de signo contrario
      const amountTolerance = Math.max(fuerzaAmount * 0.10, 10); // 10% o $10 mínimo (more lenient)
      const candidateBankTxs = bankTransactions.filter(bankTx => {
        if (usedBankTxIds.has(bankTx._id.toString())) return false;
        
        // Comparar valor absoluto del monto bancario con monto FuerzaMovil
        const bankAmountAbs = Math.abs(bankTx.amount || 0);
        if (bankAmountAbs === 0) return false;
        
        const amountDiff = Math.abs(fuerzaAmount - bankAmountAbs);
        return amountDiff <= amountTolerance;
      });

      if (candidateBankTxs.length === 0) continue;

      // Por ahora ignorar fechas ya que están mal parseadas
      // TODO: Arreglar el parsing de fechas en el futuro
      const dateFilteredCandidates = candidateBankTxs; // Sin filtro de fecha por ahora

      if (dateFilteredCandidates.length === 0) continue;

      // Sort candidates by amount difference to get best match
      const sortedCandidates = dateFilteredCandidates.sort((a, b) => {
        const diffA = Math.abs(fuerzaAmount - Math.abs(a.amount || 0));
        const diffB = Math.abs(fuerzaAmount - Math.abs(b.amount || 0));
        return diffA - diffB;
      });
      
      const bestMatch = sortedCandidates[0];
      const match = this.calculateAmountDateMatch(fuerzaTx, bestMatch);
      
      // Lower threshold for amount-based matches
      if (match.confidence >= 0.4) {
        matches.push({
          fuerzaTransactionId: fuerzaTx._id,
          bankTransactionId: bestMatch._id,
          ...match
        });
        
        usedBankTxIds.add(bestMatch._id.toString());
        usedFuerzaTxIds.add(fuerzaTx._id.toString());
      }
    }

    return matches;
  }

  /**
   * FASE 3: Matching por descripción (sin ML)
   * Solo para casos especiales usando comparación de texto simple
   */
  async findDescriptionMatches(fuerzaTransactions, bankTransactions, usedBankTxIds, usedFuerzaTxIds) {
    const matches = [];

    // Solo procesar transacciones que no tienen referencia válida y tienen monto
    // Updated minimum reference length to 4 digits
    const fuerzaWithoutRef = fuerzaTransactions.filter(tx => 
      (!tx.reference || tx.reference.length < 4) && tx.amount > 0
    );

    if (fuerzaWithoutRef.length === 0) return matches;

    // Buscar matches por descripción simple (sin ML)
    for (const fuerzaTx of fuerzaWithoutRef) {
      if (usedFuerzaTxIds.has(fuerzaTx._id.toString())) continue;

      // Buscar candidatos por palabras clave en la descripción
      const fuerzaKeywords = this.extractKeywords(fuerzaTx.description);
      
      for (const bankTx of bankTransactions) {
        if (usedBankTxIds.has(bankTx._id.toString())) continue;

        const bankKeywords = this.extractKeywords(bankTx.description);
        const keywordMatch = this.calculateKeywordSimilarity(fuerzaKeywords, bankKeywords);
        
        if (keywordMatch > 0.5) {
          const match = this.calculateDescriptionMatch(fuerzaTx, bankTx, keywordMatch);
          
          if (match.confidence >= 0.6) {
            matches.push({
              fuerzaTransactionId: fuerzaTx._id,
              bankTransactionId: bankTx._id,
              ...match
            });
            
            usedBankTxIds.add(bankTx._id.toString());
            usedFuerzaTxIds.add(fuerzaTx._id.toString());
            break; // Solo tomar el primer match
          }
        }
      }
    }

    return matches;
  }

  /**
   * Helper: Check if two references match using multiple strategies
   */
  referencesMatch(fmRef, bankRef) {
    if (!fmRef || !bankRef || fmRef.length < 4) return false;
    
    // 1. Simple substring match
    if (bankRef.includes(fmRef)) return true;
    
    // 2. Reverse: bank ref in FM ref
    if (bankRef.length >= 4 && fmRef.includes(bankRef)) return true;
    
    // 3. Ends with match
    if (bankRef.endsWith(fmRef) && bankRef.length >= fmRef.length + 2) return true;
    
    // 4. Last digits match (try 4-7 digits)
    for (let len = Math.min(fmRef.length, bankRef.length, 7); len >= 4; len--) {
      if (fmRef.slice(-len) === bankRef.slice(-len)) return true;
    }
    
    // 5. Partial: last 4-6 digits of FM in bank
    for (let len = Math.min(fmRef.length, 6); len >= 4; len--) {
      if (bankRef.includes(fmRef.slice(-len))) return true;
    }
    
    // 6. Reverse partial: last 4-6 digits of bank in FM
    for (let len = Math.min(bankRef.length, 6); len >= 4; len--) {
      if (fmRef.includes(bankRef.slice(-len))) return true;
    }
    
    return false;
  }

  /**
   * Calcular match basado en referencia
   */
  calculateReferenceMatch(fuerzaTx, bankTx) {
    let confidence = 0;
    const criteria = {
      referenceMatch: true,
      amountMatch: false,
      dateMatch: false,
      embeddingSimilarity: 0
    };

    // Clean and get references
    const fmMainRef = (fuerzaTx.reference && fuerzaTx.reference.replace(/[^\d]/g, '')) || '';
    const fmPaymentRef = (fuerzaTx.paymentReference && fuerzaTx.paymentReference.toString().replace(/[^\d]/g, '')) || '';
    const bankRef = (bankTx.reference && bankTx.reference.replace(/[^\d]/g, '')) || '';
    
    let usedRef = fmMainRef;
    let refMatchType = 'main_ref';

    // Try payment reference first (often more accurate for bank matches)
    let matchFound = false;
    if (fmPaymentRef.length >= 4 && this.referencesMatch(fmPaymentRef, bankRef)) {
      usedRef = fmPaymentRef;
      refMatchType = 'payment_ref';
      matchFound = true;
    } else if (fmMainRef.length >= 4 && this.referencesMatch(fmMainRef, bankRef)) {
      usedRef = fmMainRef;
      refMatchType = 'main_ref';
      matchFound = true;
    }
    
    if (!matchFound) {
      // No match found at all
      return {
        confidence: 0,
        matchType: 'reference',
        criteria: { referenceMatch: false, amountMatch: false, dateMatch: false, embeddingSimilarity: 0 },
        amountDifference: 0,
        dateDifference: 0
      };
    }

    // Calculate confidence based on match quality
    if (usedRef === bankRef) {
      confidence = 0.95;
    } else if (bankRef.endsWith(usedRef) && bankRef.length >= usedRef.length + 2) {
      confidence = 0.90;
    } else if (bankRef.includes(usedRef)) {
      confidence = 0.85;
    } else if (usedRef.includes(bankRef) && bankRef.length >= 4) {
      confidence = 0.80;
    } else {
      // Partial matches
      // Partial matches on last digits
      let bestMatch = 0;
      for (let len = Math.min(usedRef.length, bankRef.length, 7); len >= 4; len--) {
        const refLast = usedRef.slice(-len);
        const bankLast = bankRef.slice(-len);
        if (refLast === bankLast) {
          // Exact last N digits match - confidence based on length
          bestMatch = Math.max(bestMatch, 0.60 + (len - 4) * 0.05); // 0.60-0.75 for 4-7 digits
        }
      }
      
      // Try if last digits of reference are in bank ref
      if (bestMatch === 0 && usedRef.length >= 4) {
        for (let len = Math.min(usedRef.length, 6); len >= 4; len--) {
          const refLast = usedRef.slice(-len);
          if (bankRef.includes(refLast)) {
            bestMatch = Math.max(bestMatch, 0.50 + (len - 4) * 0.05); // 0.50-0.60 for 4-6 digits
            break;
          }
        }
      }
      
      // Try if last digits of bank are in reference
      if (bestMatch === 0 && bankRef.length >= 4) {
        for (let len = Math.min(bankRef.length, 6); len >= 4; len--) {
          const bankLast = bankRef.slice(-len);
          if (usedRef.includes(bankLast)) {
            bestMatch = Math.max(bestMatch, 0.50 + (len - 4) * 0.05);
            break;
          }
        }
      }
      
      confidence = bestMatch;
    }

    // Use paidAmount if available for FuerzaMovil (it's the actual payment amount)
    const fuerzaAmount = fuerzaTx.paidAmount || fuerzaTx.amount || 0;
    const bankAmountAbs = Math.abs(bankTx.amount || 0);
    
    // Bonus por monto similar - more lenient tolerance
    let amountDiff = 0;
    if (fuerzaAmount > 0 && bankAmountAbs > 0) {
      amountDiff = Math.abs(fuerzaAmount - bankAmountAbs);
      const amountTolerance = Math.max(fuerzaAmount * 0.10, 5); // 10% tolerance, min $5
      
      if (amountDiff <= amountTolerance) {
        confidence += 0.1;
        criteria.amountMatch = true;
      } else if (amountDiff <= amountTolerance * 2) {
        // Still give small bonus for amounts that are close
        confidence += 0.05;
      }
    }

    // Bonus por fecha cercana (use paymentDate if available)
    const fuerzaDate = fuerzaTx.paymentDate || fuerzaTx.date;
    let dateDiff = 0;
    if (fuerzaDate && bankTx.date) {
      dateDiff = Math.abs(new Date(fuerzaDate) - new Date(bankTx.date)) / (1000 * 60 * 60 * 24);
      if (dateDiff <= 3) {
        confidence += 0.05;
        criteria.dateMatch = true;
      }
    }

    return {
      confidence: Math.min(confidence, 1),
      matchType: 'reference',
      criteria: {
        ...criteria,
        referenceMatch: refMatchType // Track which reference was used
      },
      amountDifference: amountDiff / (fuerzaAmount || 1),
      dateDifference: dateDiff
    };
  }

  /**
   * Calcular match basado en monto + fecha
   */
  calculateAmountDateMatch(fuerzaTx, bankTx) {
    let confidence = 0;
    const criteria = {
      referenceMatch: false,
      amountMatch: false,
      dateMatch: false,
      embeddingSimilarity: 0
    };

    // Matching por monto (comparar valor absoluto del monto bancario)
    // Los montos deben ser muy similares en magnitud
    const bankAmountAbs = Math.abs(bankTx.amount);
    const amountDiff = Math.abs(fuerzaTx.amount - bankAmountAbs);
    const amountTolerance = Math.max(fuerzaTx.amount * 0.05, 5); // 5% o $5 mínimo
    
    if (amountDiff <= amountTolerance) {
      confidence += 0.9; // Muy alto peso para montos similares
      criteria.amountMatch = true;
    } else if (amountDiff <= amountTolerance * 2) {
      confidence += 0.6; // Peso medio para montos cercanos
    }

    // Matching por fecha (menos crítico)
    const dateDiff = Math.abs(fuerzaTx.date - bankTx.date) / (1000 * 60 * 60 * 24);
    if (dateDiff <= 7) {
      confidence += 0.2; // Menor peso para fechas
      criteria.dateMatch = true;
    } else if (dateDiff <= 30) {
      confidence += 0.1; // Bonus menor para fechas más lejanas
    }

    return {
      confidence: Math.min(confidence, 1),
      matchType: 'amount',
      criteria,
      amountDifference: amountDiff / (fuerzaTx.amount || 1),
      dateDifference: dateDiff
    };
  }

  /**
   * Calcular match basado en embeddings
   */
  calculateEmbeddingMatch(fuerzaTx, bankTx, similarity) {
    let confidence = similarity * 0.8; // Reducir peso de embeddings
    const criteria = {
      referenceMatch: false,
      amountMatch: false,
      dateMatch: false,
      embeddingSimilarity: similarity
    };

    // Bonus por monto similar
    const amountDiff = Math.abs(fuerzaTx.amount - bankTx.amount);
    const amountTolerance = Math.max(fuerzaTx.amount * 0.1, 1);
    
    if (amountDiff <= amountTolerance) {
      confidence += 0.1;
      criteria.amountMatch = true;
    }

    return {
      confidence: Math.min(confidence, 1),
      matchType: 'embedding',
      criteria,
      amountDifference: amountDiff / (fuerzaTx.amount || 1),
      dateDifference: Math.abs(fuerzaTx.date - bankTx.date) / (1000 * 60 * 60 * 24)
    };
  }

  /**
   * Extraer palabras clave de una descripción
   */
  extractKeywords(description) {
    if (!description) return [];
    
    // Limpiar y normalizar texto
    const cleanText = description.toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remover caracteres especiales
      .replace(/\s+/g, ' ')     // Normalizar espacios
      .trim();
    
    // Palabras comunes a ignorar
    const stopWords = ['el', 'la', 'de', 'del', 'en', 'con', 'por', 'para', 'a', 'al', 'y', 'o', 'un', 'una'];
    
    // Extraer palabras significativas
    const words = cleanText.split(' ')
      .filter(word => word.length > 2 && !stopWords.includes(word))
      .slice(0, 5); // Solo las primeras 5 palabras más importantes
    
    return words;
  }

  /**
   * Calcular similitud entre palabras clave
   */
  calculateKeywordSimilarity(keywords1, keywords2) {
    if (keywords1.length === 0 || keywords2.length === 0) return 0;
    
    const set1 = new Set(keywords1);
    const set2 = new Set(keywords2);
    
    // Calcular intersección
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    // Jaccard similarity
    return intersection.size / union.size;
  }

  /**
   * Calcular match basado en descripción
   */
  calculateDescriptionMatch(fuerzaTx, bankTx, keywordSimilarity) {
    let confidence = keywordSimilarity * 0.6; // Base por similitud de palabras
    const criteria = {
      referenceMatch: false,
      amountMatch: false,
      dateMatch: false,
      embeddingSimilarity: keywordSimilarity
    };

    // Bonus por monto similar
    const bankAmountAbs = Math.abs(bankTx.amount);
    const amountDiff = Math.abs(fuerzaTx.amount - bankAmountAbs);
    const amountTolerance = Math.max(fuerzaTx.amount * 0.1, 5);
    
    if (amountDiff <= amountTolerance) {
      confidence += 0.3;
      criteria.amountMatch = true;
    }

    return {
      confidence: Math.min(confidence, 1),
      matchType: 'description',
      criteria,
      amountDifference: amountDiff / (fuerzaTx.amount || 1),
      dateDifference: Math.abs(fuerzaTx.date - bankTx.date) / (1000 * 60 * 60 * 24)
    };
  }

  /**
   * Ejecutar matching optimizado para un usuario
   */
  async runOptimizedMatching(userId) {
    try {
      // Obtener transacciones del usuario
      const fuerzaTransactions = await Transaction.find({
        userId,
        type: 'fuerza_movil'
      }).lean();

      const bankTransactions = await Transaction.find({
        userId,
        type: 'bank'
      }).lean();

      if (fuerzaTransactions.length === 0 || bankTransactions.length === 0) {
        throw new Error('Need both Fuerza Movil and bank transactions to run matching');
      }

      // Eliminar matches existentes
      await Match.deleteMany({ userId });

      // Ejecutar matching optimizado
      const matches = await this.findMatchesOptimized(
        userId,
        fuerzaTransactions,
        bankTransactions
      );

      // Guardar matches
      if (matches.length > 0) {
        await Match.insertMany(matches);
      }

      return {
        success: true,
        matchesFound: matches.length,
        fuerzaTransactions: fuerzaTransactions.length,
        bankTransactions: bankTransactions.length
      };

    } catch (error) {
      console.error('Error in optimized matching:', error);
      throw error;
    }
  }
}

module.exports = new OptimizedTransactionService();
