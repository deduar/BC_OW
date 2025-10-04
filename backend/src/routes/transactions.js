const express = require('express');
const Transaction = require('../models/Transaction');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get user's transactions
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const { type, fileId, limit = 100, offset = 0 } = req.query;

    const query = { userId };
    if (type) query.type = type;
    if (fileId) query.fileId = fileId;

    const transactions = await Transaction.find(query)
      .populate('fileId', 'filename type')
      .sort({ date: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    const total = await Transaction.countDocuments(query);

    res.json({
      transactions,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: total > parseInt(offset) + parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ error: 'Failed to retrieve transactions' });
  }
});

// Get transaction by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const transactionId = req.params.id;

    const transaction = await Transaction.findOne({
      _id: transactionId,
      userId
    }).populate('fileId', 'filename type');

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({ transaction });
  } catch (error) {
    console.error('Get transaction error:', error);
    res.status(500).json({ error: 'Failed to retrieve transaction' });
  }
});

// Get transaction statistics
router.get('/stats/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;

    const stats = await Transaction.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          avgAmount: { $avg: '$amount' },
          minAmount: { $min: '$amount' },
          maxAmount: { $max: '$amount' }
        }
      }
    ]);

    const totalTransactions = await Transaction.countDocuments({ userId });

    res.json({
      totalTransactions,
      byType: stats
    });
  } catch (error) {
    console.error('Get transaction stats error:', error);
    res.status(500).json({ error: 'Failed to retrieve transaction statistics' });
  }
});

// Search transactions
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const { q, type, dateFrom, dateTo, amountMin, amountMax } = req.query;

    const query = { userId };

    if (type) query.type = type;
    if (dateFrom || dateTo) {
      query.date = {};
      if (dateFrom) query.date.$gte = new Date(dateFrom);
      if (dateTo) query.date.$lte = new Date(dateTo);
    }
    if (amountMin || amountMax) {
      query.amount = {};
      if (amountMin) query.amount.$gte = parseFloat(amountMin);
      if (amountMax) query.amount.$lte = parseFloat(amountMax);
    }

    let transactions;

    if (q) {
      // Text search
      query.$or = [
        { description: { $regex: q, $options: 'i' } },
        { reference: { $regex: q, $options: 'i' } },
        { clientName: { $regex: q, $options: 'i' } },
        { bank: { $regex: q, $options: 'i' } }
      ];
    }

    transactions = await Transaction.find(query)
      .populate('fileId', 'filename type')
      .sort({ date: -1 })
      .limit(50);

    res.json({ transactions });
  } catch (error) {
    console.error('Search transactions error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;