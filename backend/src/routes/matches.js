const express = require('express');
const Match = require('../models/Match');
const Feedback = require('../models/Feedback');
const Transaction = require('../models/Transaction');
const { authenticateToken } = require('../middleware/auth');
const transactionService = require('../services/transactionService');

const router = express.Router();

// Run matching for user's data
router.post('/run', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;

    // Get all user's transactions
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
        error: 'Need both Fuerza Movil and bank transactions to run matching'
      });
    }

    // Delete existing matches
    await Match.deleteMany({ userId });

    // Run matching
    const matches = await transactionService.findMatches(
      userId,
      fuerzaTransactions,
      bankTransactions
    );

    res.json({
      message: 'Matching completed',
      matchesFound: matches.length,
      matches: matches.slice(0, 50) // Return first 50 matches
    });
  } catch (error) {
    console.error('Run matching error:', error);
    res.status(500).json({ error: 'Matching failed' });
  }
});

// Get user's matches
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const { confidence, status, limit = 50, offset = 0 } = req.query;

    const query = { userId };
    if (confidence) query.confidence = { $gte: parseFloat(confidence) };
    if (status) query.status = status;

    const matches = await Match.find(query)
      .populate({
        path: 'fuerzaTransactionId',
        select: 'reference amount date description clientName'
      })
      .populate({
        path: 'bankTransactionId',
        select: 'reference amount date description bank'
      })
      .sort({ confidence: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    const total = await Match.countDocuments(query);

    res.json({
      matches,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: total > parseInt(offset) + parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get matches error:', error);
    res.status(500).json({ error: 'Failed to retrieve matches' });
  }
});

// Get match by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const matchId = req.params.id;

    const match = await Match.findOne({ _id: matchId, userId })
      .populate({
        path: 'fuerzaTransactionId',
        populate: { path: 'fileId', select: 'filename' }
      })
      .populate({
        path: 'bankTransactionId',
        populate: { path: 'fileId', select: 'filename' }
      });

    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    res.json({ match });
  } catch (error) {
    console.error('Get match error:', error);
    res.status(500).json({ error: 'Failed to retrieve match' });
  }
});

// Submit feedback for a match
router.post('/:id/feedback', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const matchId = req.params.id;
    const { action, explanation } = req.body;

    if (!['confirm', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    // Get the match
    const match = await Match.findOne({ _id: matchId, userId });
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    // Create feedback record
    const feedback = new Feedback({
      userId,
      matchId,
      action,
      explanation: explanation || '',
      previousMatch: {
        confidence: match.confidence,
        matchType: match.matchType,
        criteria: match.criteria
      }
    });

    await feedback.save();

    // Update match status
    match.status = action === 'confirm' ? 'manual' : 'rejected';
    await match.save();

    res.json({
      message: 'Feedback submitted successfully',
      feedback: {
        id: feedback._id,
        action: feedback.action,
        submittedAt: feedback.submittedAt
      }
    });
  } catch (error) {
    console.error('Submit feedback error:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Get matching statistics
router.get('/stats/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;

    const stats = await Match.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          totalMatches: { $sum: 1 },
          avgConfidence: { $avg: '$confidence' },
          highConfidenceMatches: {
            $sum: { $cond: [{ $gte: ['$confidence', 0.8] }, 1, 0] }
          },
          mediumConfidenceMatches: {
            $sum: {
              $cond: [
                { $and: [{ $gte: ['$confidence', 0.6] }, { $lt: ['$confidence', 0.8] }] },
                1,
                0
              ]
            }
          },
          lowConfidenceMatches: {
            $sum: { $cond: [{ $lt: ['$confidence', 0.6] }, 1, 0] }
          }
        }
      }
    ]);

    const feedbackStats = await Feedback.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: '$action',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      matchingStats: stats[0] || {
        totalMatches: 0,
        avgConfidence: 0,
        highConfidenceMatches: 0,
        mediumConfidenceMatches: 0,
        lowConfidenceMatches: 0
      },
      feedbackStats: feedbackStats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, { confirm: 0, reject: 0 })
    });
  } catch (error) {
    console.error('Get matching stats error:', error);
    res.status(500).json({ error: 'Failed to retrieve matching statistics' });
  }
});

module.exports = router;