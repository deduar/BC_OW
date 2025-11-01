const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');

// Connect to MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/bank_reconciliation';

async function debugMatching() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB\n');

    // Get sample transactions
    const fuerzaTxs = await Transaction.find({ type: 'fuerza_movil' })
      .limit(10)
      .sort({ date: -1 });

    const bankTxs = await Transaction.find({ type: 'bank' })
      .limit(10)
      .sort({ date: -1 });

    console.log(`📊 Sample Fuerza Móvil transactions (${fuerzaTxs.length}):\n`);
    fuerzaTxs.forEach((tx, idx) => {
      const ref = (tx.reference || '').replace(/[^\d]/g, '');
      const paymentRef = (tx.paymentReference || '').toString().replace(/[^\d]/g, '');
      const invoice = (tx.invoiceNumber || '').replace(/[^\d]/g, '');
      console.log(`${idx + 1}. Ref: "${ref}" (${ref.length} digits), PaymentRef: "${paymentRef}", Invoice: "${invoice}"`);
    });

    console.log(`\n📊 Sample Bank transactions (${bankTxs.length}):\n`);
    bankTxs.forEach((tx, idx) => {
      const ref = (tx.reference || '').replace(/[^\d]/g, '');
      const desc = (tx.description || '').substring(0, 50);
      const descDigits = (tx.description || '').replace(/[^\d]/g, '');
      console.log(`${idx + 1}. Ref: "${ref}" (${ref.length} digits)`);
      console.log(`   Desc: "${desc}..."`);
      console.log(`   Desc Digits: "${descDigits.substring(0, 30)}..." (${descDigits.length} digits)`);
      console.log('');
    });

    // Test matching logic on samples
    console.log('\n🔍 Testing matching logic:\n');
    console.log('='.repeat(80));

    function cleanRef(ref) {
      return (ref || '').replace(/[^\d]/g, '');
    }

    function referencesMatch(fmRef, bankRef) {
      const fmCleaned = cleanRef(fmRef);
      const bankCleaned = cleanRef(bankRef);
      
      if (fmCleaned.length < 4 || bankCleaned.length < 4) {
        return { matched: false, reason: 'Too short' };
      }

      // Check if complete FM reference is contained in Bank
      if (bankCleaned.includes(fmCleaned)) {
        return { matched: true, reason: `Bank "${bankCleaned}" contains FM "${fmCleaned}"` };
      }

      // Try without leading zeros
      const fmNoLeadingZeros = fmCleaned.replace(/^0+/, '');
      if (fmNoLeadingZeros.length >= 4 && fmNoLeadingZeros !== fmCleaned) {
        if (bankCleaned.includes(fmNoLeadingZeros)) {
          return { matched: true, reason: `Bank "${bankCleaned}" contains FM "${fmNoLeadingZeros}" (no leading zeros)` };
        }
      }

      return { matched: false, reason: `Bank "${bankCleaned}" does NOT contain FM "${fmCleaned}"` };
    }

    let potentialMatches = 0;
    for (const fmTx of fuerzaTxs.slice(0, 5)) {
      const fmMainRef = cleanRef(fmTx.reference);
      if (fmMainRef.length < 4) continue;

      console.log(`\nFM Transaction: Ref="${fmMainRef}"`);
      
      for (const bankTx of bankTxs) {
        const bankRef = cleanRef(bankTx.reference);
        const bankDesc = cleanRef(bankTx.description || '');

        // Check in bank reference
        const refMatch = bankRef.length >= 4 ? referencesMatch(fmMainRef, bankRef) : null;
        if (refMatch?.matched) {
          console.log(`  ✅ MATCH in Bank Ref: "${bankRef}" - ${refMatch.reason}`);
          potentialMatches++;
          break;
        }

        // Check in bank description
        const descMatch = bankDesc.length >= 4 ? referencesMatch(fmMainRef, bankDesc) : null;
        if (descMatch?.matched) {
          console.log(`  ✅ MATCH in Bank Desc: "${bankDesc.substring(0, 30)}..." - ${descMatch.reason}`);
          potentialMatches++;
          break;
        }
      }

      if (potentialMatches === 0) {
        console.log(`  ❌ No match found for FM "${fmMainRef}"`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`\n📊 Summary: ${potentialMatches} potential matches found in sample`);

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

debugMatching();

