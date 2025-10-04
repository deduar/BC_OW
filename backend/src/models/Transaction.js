const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  fileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'File',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['fuerza_movil', 'bank'],
    required: true
  },
  reference: {
    type: String,
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  embedding: {
    type: [Number], // 768-dimensional vector
    default: []
  },
  // Fuerza Movil specific fields
  clientCode: {
    type: String
  },
  clientName: {
    type: String
  },
  invoiceNumber: {
    type: String
  },
  dueDate: {
    type: Date
  },
  totalAmount: {
    type: Number
  },
  bank: {
    type: String
  },
  paymentDate: {
    type: Date
  },
  paymentReference: {
    type: String
  },
  paidAmount: {
    type: Number
  },
  paymentMethod: {
    type: String
  },
  receiptNotes: {
    type: String
  },
  receiptStatus: {
    type: String
  },
  // Bank specific fields
  balance: {
    type: Number
  },
  transactionType: {
    type: String
  },
  accountNumber: {
    type: String
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
transactionSchema.index({ userId: 1, type: 1, date: -1 });
transactionSchema.index({ userId: 1, reference: 1 });
transactionSchema.index({ userId: 1, amount: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);