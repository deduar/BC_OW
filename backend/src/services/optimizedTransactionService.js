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

    for (const fuerzaTx of fuerzaTransactions) {
      if (!fuerzaTx.reference || fuerzaTx.reference.length < 3) continue;

      // Buscar transacciones bancarias que contengan la referencia de FuerzaMovil
      const candidateBankTxs = bankTransactions.filter(bankTx => 
        bankTx.reference && 
        bankTx.reference.includes(fuerzaTx.reference) &&
        !usedBankTxIds.has(bankTx._id.toString())
      );

      if (candidateBankTxs.length === 0) continue;

      // Para cada candidato, calcular score de matching
      for (const bankTx of candidateBankTxs) {
        const match = this.calculateReferenceMatch(fuerzaTx, bankTx);
        
        if (match.confidence >= 0.6) { // Umbral alto para referencias
          matches.push({
            fuerzaTransactionId: fuerzaTx._id,
            bankTransactionId: bankTx._id,
            ...match
          });
          
          usedBankTxIds.add(bankTx._id.toString());
          usedFuerzaTxIds.add(fuerzaTx._id.toString());
          break; // Solo tomar el primer match por referencia
        }
      }
    }

    return matches;
  }

  /**
   * FASE 2: Matching por monto + fecha
   * Solo para transacciones sin referencia válida
   */
  async findAmountDateMatches(fuerzaTransactions, bankTransactions, usedBankTxIds, usedFuerzaTxIds) {
    const matches = [];

    for (const fuerzaTx of fuerzaTransactions) {
      if (fuerzaTx.amount <= 0) continue; // Saltar transacciones sin monto

      // Buscar candidatos por monto (tolerancia pequeña pero realista)
      // Los montos deben ser muy similares en magnitud pero de signo contrario
      const amountTolerance = Math.max(fuerzaTx.amount * 0.05, 5); // 5% o $5 mínimo
      const candidateBankTxs = bankTransactions.filter(bankTx => {
        // Comparar valor absoluto del monto bancario con monto FuerzaMovil
        const bankAmountAbs = Math.abs(bankTx.amount);
        const amountDiff = Math.abs(fuerzaTx.amount - bankAmountAbs);
        return amountDiff <= amountTolerance && 
               !usedBankTxIds.has(bankTx._id.toString());
      });

      if (candidateBankTxs.length === 0) continue;

      // Por ahora ignorar fechas ya que están mal parseadas
      // TODO: Arreglar el parsing de fechas en el futuro
      const dateFilteredCandidates = candidateBankTxs; // Sin filtro de fecha por ahora

      if (dateFilteredCandidates.length === 0) continue;

      // Tomar el primer candidato (mejor match por monto)
      const bestMatch = dateFilteredCandidates[0];

      const match = this.calculateAmountDateMatch(fuerzaTx, bestMatch);
      
      if (match.confidence >= 0.5) {
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
    const fuerzaWithoutRef = fuerzaTransactions.filter(tx => 
      (!tx.reference || tx.reference.length < 3) && tx.amount > 0
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

    // Referencia exacta = máxima confianza
    if (fuerzaTx.reference === bankTx.reference) {
      confidence = 0.95;
    } else if (bankTx.reference.includes(fuerzaTx.reference)) {
      // Referencia FuerzaMovil es subcadena de referencia bancaria
      confidence = 0.85;
    }

    // Bonus por monto similar
    const amountDiff = Math.abs(fuerzaTx.amount - bankTx.amount);
    const amountTolerance = Math.max(fuerzaTx.amount * 0.1, 1);
    
    if (amountDiff <= amountTolerance) {
      confidence += 0.1;
      criteria.amountMatch = true;
    }

    // Bonus por fecha cercana
    const dateDiff = Math.abs(fuerzaTx.date - bankTx.date) / (1000 * 60 * 60 * 24);
    if (dateDiff <= 3) {
      confidence += 0.05;
      criteria.dateMatch = true;
    }

    return {
      confidence: Math.min(confidence, 1),
      matchType: 'reference',
      criteria,
      amountDifference: amountDiff / (fuerzaTx.amount || 1),
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
