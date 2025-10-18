const express = require('express');
const Match = require('../models/Match');
const Transaction = require('../models/Transaction');
const { authenticateToken } = require('../middleware/auth');
const optimizedTransactionService = require('../services/optimizedTransactionService');

const router = express.Router();

// Analizar montos antes del matching
router.post('/analyze-amounts', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    
    const fuerzaTransactions = await Transaction.find({
      userId,
      type: 'fuerza_movil',
      amount: { $gt: 0 }
    }).lean();

    const bankTransactions = await Transaction.find({
      userId,
      type: 'bank'
    }).lean();

    // Analizar coincidencias de montos
    const amountAnalysis = [];
    
    for (const fuerzaTx of fuerzaTransactions.slice(0, 10)) { // Solo primeras 10 para análisis
      const bankAmountAbs = Math.abs(fuerzaTx.amount);
      const tolerance = Math.max(fuerzaTx.amount * 0.01, 0.1);
      
      const candidates = bankTransactions.filter(bankTx => {
        const bankAbs = Math.abs(bankTx.amount);
        const diff = Math.abs(fuerzaTx.amount - bankAbs);
        return diff <= tolerance;
      });

      amountAnalysis.push({
        fuerzaRef: fuerzaTx.reference,
        fuerzaAmount: fuerzaTx.amount,
        fuerzaDate: fuerzaTx.date,
        candidates: candidates.map(c => ({
          bankRef: c.reference,
          bankAmount: c.amount,
          bankAmountAbs: Math.abs(c.amount),
          amountDiff: Math.abs(fuerzaTx.amount - Math.abs(c.amount)),
          bankDate: c.date,
          dateDiff: Math.abs(new Date(fuerzaTx.date) - new Date(c.date)) / (1000 * 60 * 60 * 24)
        }))
      });
    }

    res.json({
      analysis: amountAnalysis,
      summary: {
        fuerzaTransactions: fuerzaTransactions.length,
        bankTransactions: bankTransactions.length,
        fuerzaWithAmount: fuerzaTransactions.filter(tx => tx.amount > 0).length
      }
    });
    
  } catch (error) {
    console.error('Amount analysis error:', error);
    res.status(500).json({ 
      error: 'Amount analysis failed',
      details: error.message 
    });
  }
});

// Ejecutar matching optimizado
router.post('/run-optimized', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    
    console.log(`Starting optimized matching for user: ${req.user.email}`);
    
    const result = await optimizedTransactionService.runOptimizedMatching(userId);
    
    res.json({
      message: 'Optimized matching completed successfully',
      ...result
    });
  } catch (error) {
    console.error('Optimized matching error:', error);
    res.status(500).json({ 
      error: 'Optimized matching failed',
      details: error.message 
    });
  }
});

// Comparar resultados entre algoritmo original y optimizado
router.post('/compare-algorithms', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Ejecutar algoritmo original
    console.log('Running original algorithm...');
    const originalStart = Date.now();
    
    const fuerzaTransactions = await Transaction.find({
      userId,
      type: 'fuerza_movil'
    }).lean();

    const bankTransactions = await Transaction.find({
      userId,
      type: 'bank'
    }).lean();

    if (fuerzaTransactions.length === 0 || bankTransactions.length === 0) {
      return res.status(400).json({
        error: 'Need both Fuerza Movil and bank transactions to run comparison'
      });
    }

    // Algoritmo original (simplificado para comparación)
    const originalMatches = [];
    for (const fuerzaTx of fuerzaTransactions.slice(0, 10)) { // Limitar para prueba
      for (const bankTx of bankTransactions.slice(0, 20)) {
        if (bankTx.reference && fuerzaTx.reference && 
            bankTx.reference.includes(fuerzaTx.reference)) {
          originalMatches.push({
            fuerzaTransactionId: fuerzaTx._id,
            bankTransactionId: bankTx._id,
            confidence: 0.8,
            matchType: 'reference'
          });
          break;
        }
      }
    }
    
    const originalTime = Date.now() - originalStart;
    
    // Ejecutar algoritmo optimizado
    console.log('Running optimized algorithm...');
    const optimizedStart = Date.now();
    
    const optimizedMatches = await optimizedTransactionService.findMatchesOptimized(
      userId,
      fuerzaTransactions.slice(0, 10), // Mismo límite para comparación justa
      bankTransactions.slice(0, 20)
    );
    
    const optimizedTime = Date.now() - optimizedStart;
    
    res.json({
      comparison: {
        original: {
          matchesFound: originalMatches.length,
          executionTime: originalTime,
          algorithm: 'Original (simplified)'
        },
        optimized: {
          matchesFound: optimizedMatches.length,
          executionTime: optimizedTime,
          algorithm: 'Optimized 3-phase'
        },
        improvement: {
          timeReduction: `${((originalTime - optimizedTime) / originalTime * 100).toFixed(1)}%`,
          matchesDifference: optimizedMatches.length - originalMatches.length
        }
      },
      sampleMatches: {
        original: originalMatches.slice(0, 5),
        optimized: optimizedMatches.slice(0, 5)
      }
    });
    
  } catch (error) {
    console.error('Algorithm comparison error:', error);
    res.status(500).json({ 
      error: 'Algorithm comparison failed',
      details: error.message 
    });
  }
});

// Obtener estadísticas de matches por tipo
router.get('/stats-by-type', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;

    const stats = await Match.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: '$matchType',
          count: { $sum: 1 },
          avgConfidence: { $avg: '$confidence' },
          highConfidence: {
            $sum: { $cond: [{ $gte: ['$confidence', 0.8] }, 1, 0] }
          },
          mediumConfidence: {
            $sum: {
              $cond: [
                { $and: [{ $gte: ['$confidence', 0.6] }, { $lt: ['$confidence', 0.8] }] },
                1,
                0
              ]
            }
          }
        }
      },
      { $sort: { count: -1 } }
    ]);

    res.json({
      matchTypeStats: stats,
      totalMatches: stats.reduce((sum, stat) => sum + stat.count, 0)
    });
  } catch (error) {
    console.error('Get match type stats error:', error);
    res.status(500).json({ error: 'Failed to retrieve match type statistics' });
  }
});

module.exports = router;
