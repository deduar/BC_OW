const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  fuerzaTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    required: true
  },
  bankTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    required: true
  },
  confidence: {
    type: Number,
    required: true,
    min: 0,
    max: 1
  },
  matchType: {
    type: String,
    enum: ['exact', 'reference', 'amount', 'embedding', 'manual'],
    required: true
  },
  matchedAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['auto', 'manual', 'rejected'],
    default: 'auto'
  },
  // Matching criteria details
  criteria: {
    referenceMatch: {
      type: Boolean,
      default: false
    },
    amountMatch: {
      type: Boolean,
      default: false
    },
    dateMatch: {
      type: Boolean,
      default: false
    },
    embeddingSimilarity: {
      type: Number,
      min: 0,
      max: 1
    }
  },
  // Amount difference in percentage (for fuzzy matching)
  amountDifference: {
    type: Number,
    default: 0
  },
  // Date difference in days
  dateDifference: {
    type: Number,
    default: 0
  }
});

// Compound indexes
matchSchema.index({ userId: 1, matchedAt: -1 });
matchSchema.index({ userId: 1, confidence: -1 });
matchSchema.index({ fuerzaTransactionId: 1 });
matchSchema.index({ bankTransactionId: 1 });

// Ensure unique matches per user
matchSchema.index({
  userId: 1,
  fuerzaTransactionId: 1,
  bankTransactionId: 1
}, { unique: true });

module.exports = mongoose.model('Match', matchSchema);