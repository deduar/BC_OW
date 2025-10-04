const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  matchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Match',
    required: true
  },
  action: {
    type: String,
    enum: ['confirm', 'reject'],
    required: true
  },
  explanation: {
    type: String,
    maxlength: 500
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  // Store previous match details for ML retraining
  previousMatch: {
    confidence: Number,
    matchType: String,
    criteria: {
      referenceMatch: Boolean,
      amountMatch: Boolean,
      dateMatch: Boolean,
      embeddingSimilarity: Number
    }
  },
  // User feedback quality score (for future ML improvements)
  feedbackQuality: {
    type: Number,
    min: 1,
    max: 5,
    default: 3
  }
});

// Indexes
feedbackSchema.index({ userId: 1, submittedAt: -1 });
feedbackSchema.index({ matchId: 1 });

// Prevent duplicate feedback per match
feedbackSchema.index({ userId: 1, matchId: 1 }, { unique: true });

module.exports = mongoose.model('Feedback', feedbackSchema);