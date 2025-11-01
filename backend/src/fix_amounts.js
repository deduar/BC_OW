const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/bank_reconciliation';

// Patterns for amount extraction (same as fileService.js)
const amountPatternUS = /(?:BS\.?|RD\$|USD|€|£|POR\s+BS\.?)?\s*([\d]{1,3}(?:,\d{3})*\.\d{2})/i;
const amountPatternEU = /(?:BS\.?|RD\$|USD|€|£|POR\s+BS\.?)?\s*([\d]{1,3}(?:\.\d{3})*,\d{2})/i;
const amountPatternSimple = /(?:BS\.?|RD\$|USD|€|£|POR\s+BS\.?)?\s*(\d+\.\d{2})/i;

function extractAmountFromDescription(description) {
  if (!description) return null;

  // Check EU format FIRST to avoid false matches from simple pattern
  let amountMatchEU = description.match(amountPatternEU);
  let amountMatchUS = description.match(amountPatternUS);
  let amountMatchSimple = description.match(amountPatternSimple);

  if (amountMatchEU) {
    // European format: 5.523,89 -> 5523.89
    const amount = amountMatchEU[1].replace(/\./g, '').replace(',', '.');
    return parseFloat(amount);
  } else if (amountMatchUS) {
    // US format: 5,523.89 -> 5523.89
    const amount = amountMatchUS[1].replace(/,/g, '');
    return parseFloat(amount);
  } else if (amountMatchSimple) {
    // Simple format: only use if it's not part of a larger EU format
    const simpleValue = amountMatchSimple[1];
    const potentialEU = description.match(/\d+\.\d+,\d+/);
    if (!potentialEU || !potentialEU[0].includes(simpleValue)) {
      return parseFloat(simpleValue);
    }
  }

  return null;
}

async function fixAmounts() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Get all bank transactions
    const bankTransactions = await Transaction.find({ type: 'bank' });
    console.log(`📊 Found ${bankTransactions.length} bank transactions\n`);

    let fixed = 0;
    let skipped = 0;
    let errors = 0;

    for (const tx of bankTransactions) {
      const extractedAmount = extractAmountFromDescription(tx.description);
      
      if (extractedAmount && Math.abs(extractedAmount - tx.amount) > 0.01) {
        // Amount is significantly different - likely needs fixing
        const oldAmount = tx.amount;
        const newAmount = extractedAmount;
        
        // Only fix if the difference is significant (more than 10% or $10)
        const diff = Math.abs(newAmount - oldAmount);
        const percentDiff = (diff / Math.abs(oldAmount)) * 100;
        
        if (diff > 10 || percentDiff > 10) {
          console.log(`🔧 Fixing transaction ${tx.reference}:`);
          console.log(`   Old amount: ${oldAmount}`);
          console.log(`   New amount: ${newAmount}`);
          console.log(`   Difference: ${diff.toFixed(2)} (${percentDiff.toFixed(1)}%)`);
          console.log('');
          
          tx.amount = newAmount;
          await tx.save();
          fixed++;
        } else {
          skipped++;
        }
      } else if (!extractedAmount) {
        // Couldn't extract amount from description - might be OK
        skipped++;
      } else {
        // Amount matches extracted amount - no fix needed
        skipped++;
      }
    }

    console.log('\n=== SUMMARY ===');
    console.log(`✅ Fixed: ${fixed} transactions`);
    console.log(`⏭️  Skipped: ${skipped} transactions`);
    console.log(`❌ Errors: ${errors}`);

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  fixAmounts();
}

module.exports = { fixAmounts, extractAmountFromDescription };

