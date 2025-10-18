const Transaction = require('../models/Transaction');
const Match = require('../models/Match');
const axios = require('axios');

class OptimizedTransactionService {
  constructor() {
    this.mlServiceUrl = process.env.ML_SERVICE_URL || 'http://ml:5000';
  }

  /**
   * Algoritmo optimizado de matching en 3 fases
   * Fase 1: Matching por referencia (prioridad alta)
   * Fase 2: Matching por monto + fecha (solo si no hay referencia)
   * Fase 3: Embeddings (solo casos especiales)
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

    // FASE 3: Embeddings (solo casos especiales y baja confianza)
    console.log('Phase 3: Embedding-based matching (limited)');
    const finalFuerza = fuerzaTransactions.filter(tx => !usedFuerzaTxIds.has(tx._id.toString()));
    const finalBank = bankTransactions.filter(tx => !usedBankTxIds.has(tx._id.toString()));
    
    // Solo procesar un subconjunto pequeño para embeddings
    const embeddingMatches = await this.findEmbeddingMatches(
      finalFuerza.slice(0, 50), // Limitar a 50 transacciones
      finalBank.slice(0, 100),  // Limitar a 100 transacciones
      usedBankTxIds, 
      usedFuerzaTxIds
    );
    matches.push(...embeddingMatches);
    console.log(`Phase 3 completed: ${embeddingMatches.length} matches found`);

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
   * FASE 3: Matching por embeddings (limitado)
   * Solo para casos especiales y con límites de procesamiento
   */
  async findEmbeddingMatches(fuerzaTransactions, bankTransactions, usedBankTxIds, usedFuerzaTxIds) {
    const matches = [];

    // Solo procesar transacciones que no tienen referencia válida
    const fuerzaWithoutRef = fuerzaTransactions.filter(tx => 
      !tx.reference || tx.reference.length < 3
    );

    if (fuerzaWithoutRef.length === 0) return matches;

    // Generar embeddings solo para estas transacciones
    const descriptions = fuerzaWithoutRef.map(tx => tx.description);
    const embeddings = await this.generateEmbeddings(descriptions);

    // Agregar embeddings a las transacciones
    fuerzaWithoutRef.forEach((tx, index) => {
      tx.embedding = embeddings[index] || [];
    });

    // Buscar matches por similitud semántica
    for (const fuerzaTx of fuerzaWithoutRef) {
      if (!fuerzaTx.embedding || fuerzaTx.embedding.length === 0) continue;

      let bestMatch = null;
      let bestSimilarity = 0;

      for (const bankTx of bankTransactions) {
        if (usedBankTxIds.has(bankTx._id.toString())) continue;

        // Generar embedding para transacción bancaria si no existe
        if (!bankTx.embedding || bankTx.embedding.length === 0) {
          const bankEmbeddings = await this.generateEmbeddings([bankTx.description]);
          bankTx.embedding = bankEmbeddings[0] || [];
        }

        if (bankTx.embedding.length === 0) continue;

        const similarity = await this.calculateEmbeddingSimilarity(fuerzaTx.embedding, bankTx.embedding);
        
        if (similarity > bestSimilarity && similarity > 0.7) {
          bestSimilarity = similarity;
          bestMatch = bankTx;
        }
      }

      if (bestMatch && bestSimilarity > 0.7) {
        const match = this.calculateEmbeddingMatch(fuerzaTx, bestMatch, bestSimilarity);
        
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
   * Generar embeddings para textos
   */
  async generateEmbeddings(texts) {
    try {
      const response = await axios.post(`${this.mlServiceUrl}/embeddings`, {
        texts
      });
      return response.data.embeddings;
    } catch (error) {
      console.error('Error generating embeddings:', error);
      return texts.map(() => []);
    }
  }

  /**
   * Calcular similitud entre embeddings
   */
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
