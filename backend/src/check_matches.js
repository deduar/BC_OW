const mongoose = require('mongoose');
const Match = require('./models/Match');
const Transaction = require('./models/Transaction');

// Connect to MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27018/bank_reconciliation';

async function checkMatches() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB\n');

    // Get transaction counts
    const totalFuerza = await Transaction.countDocuments({ type: 'fuerza_movil' });
    const totalBank = await Transaction.countDocuments({ type: 'bank' });
    const totalMatches = await Match.countDocuments({});
    
    console.log(`📊 Estadísticas:`);
    console.log(`  - Transacciones Fuerza Móvil: ${totalFuerza}`);
    console.log(`  - Transacciones Bancarias: ${totalBank}`);
    console.log(`  - Matches encontrados: ${totalMatches}`);
    console.log('');

    // Get all matches with populated transactions
    const matches = await Match.find({})
      .populate('fuerzaTransactionId')
      .populate('bankTransactionId')
      .sort({ confidence: -1 });

    console.log(`📊 Total matches found: ${matches.length}\n`);
    console.log('='.repeat(80));
    console.log('REVISIÓN DE MATCHES - VERIFICACIÓN DE REGLAS\n');
    console.log('='.repeat(80));

    let invalidMatches = [];
    let validMatches = [];

    // Function to clean and extract digits
    function cleanRef(ref) {
      if (!ref) return '';
      return ref.toString().replace(/[^\d]/g, '');
    }

    // Function to check if FM reference is substring of Bank reference
    function isValidMatch(fmRef, bankRef) {
      const fmCleaned = cleanRef(fmRef);
      const bankCleaned = cleanRef(bankRef);
      
      if (fmCleaned.length < 4 || bankCleaned.length < 4) {
        return { valid: false, reason: 'Reference too short' };
      }

      // Check if complete FM reference is contained in Bank reference
      if (bankCleaned.includes(fmCleaned)) {
        return { valid: true, matchType: 'main_ref' };
      }

      // Try without leading zeros
      const fmNoLeadingZeros = fmCleaned.replace(/^0+/, '');
      if (fmNoLeadingZeros.length >= 4 && fmNoLeadingZeros !== fmCleaned) {
        if (bankCleaned.includes(fmNoLeadingZeros)) {
          return { valid: true, matchType: 'main_ref_no_zeros' };
        }
      }

      return { valid: false, reason: `FM "${fmCleaned}" not found in Bank "${bankCleaned}"` };
    }

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const fmTx = match.fuerzaTransactionId;
      const bankTx = match.bankTransactionId;

      if (!fmTx || !bankTx) {
        console.log(`⚠️  Match ${i + 1}: Missing transaction data`);
        continue;
      }

      const fmMainRef = cleanRef(fmTx.reference);
      const bankRef = cleanRef(bankTx.reference);
      const bankDesc = bankTx.description || '';
      const bankDescDigits = cleanRef(bankDesc);

      // Extract other FM references
      const fmPaymentRef = cleanRef(fmTx.paymentReference);
      const fmInvoiceNumber = cleanRef(fmTx.invoiceNumber);

      console.log(`\n${'─'.repeat(80)}`);
      console.log(`Match ${i + 1}:`);
      console.log(`  Confidence: ${match.confidence.toFixed(3)}`);
      console.log(`  Match Type: ${match.matchType}`);
      console.log(`  Criteria: ${JSON.stringify(match.criteria, null, 2)}`);
      console.log(`  FM Main Ref: "${fmTx.reference}" (cleaned: "${fmMainRef}")`);
      console.log(`  FM Payment Ref: "${fmTx.paymentReference || 'N/A'}" (cleaned: "${fmPaymentRef}")`);
      console.log(`  FM Invoice: "${fmTx.invoiceNumber || 'N/A'}" (cleaned: "${fmInvoiceNumber}")`);
      console.log(`  Bank Ref: "${bankTx.reference}" (cleaned: "${bankRef}")`);
      console.log(`  Bank Desc: "${bankDesc.substring(0, 60)}..."`);
      console.log(`  Bank Desc Digits: "${bankDescDigits}"`);

      // Check main reference match
      const mainRefCheck = isValidMatch(fmMainRef, bankRef);
      
      // Check in description
      let descCheck = null;
      if (bankDescDigits) {
        descCheck = isValidMatch(fmMainRef, bankDescDigits);
      }

      // Check in combined
      const combinedDigits = bankRef + bankDescDigits;
      const combinedCheck = isValidMatch(fmMainRef, combinedDigits);

      // Determine if match is valid
      const isMainRefValid = mainRefCheck.valid || descCheck?.valid || combinedCheck?.valid;
      const usedRefType = match.criteria?.referenceMatch || 'unknown';

      if (!isMainRefValid && match.matchType === 'reference') {
        // This is a reference match that doesn't comply with rules
        console.log(`  ❌ INVALID MATCH: Main reference doesn't comply with rules`);
        console.log(`     Main Ref Check: ${mainRefCheck.valid ? '✅' : '❌'} ${mainRefCheck.reason || ''}`);
        console.log(`     Desc Check: ${descCheck?.valid ? '✅' : '❌'} ${descCheck?.reason || ''}`);
        console.log(`     Combined Check: ${combinedCheck?.valid ? '✅' : '❌'} ${combinedCheck?.reason || ''}`);
        
        invalidMatches.push({
          matchId: match._id,
          fmRef: fmMainRef,
          bankRef: bankRef,
          confidence: match.confidence,
          criteria: match.criteria,
          reason: 'Main reference not contained in bank reference'
        });
      } else if (isMainRefValid) {
        console.log(`  ✅ VALID MATCH: Main reference complies`);
        validMatches.push({
          matchId: match._id,
          fmRef: fmMainRef,
          bankRef: bankRef,
          confidence: match.confidence
        });
      } else if (match.matchType !== 'reference') {
        console.log(`  ℹ️  Non-reference match (${match.matchType}) - skipping reference validation`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('\n📊 RESUMEN:');
    console.log(`  ✅ Matches válidos: ${validMatches.length}`);
    console.log(`  ❌ Matches inválidos: ${invalidMatches.length}`);
    console.log(`  ℹ️  Total revisados: ${matches.length}`);

    if (invalidMatches.length > 0) {
      console.log('\n❌ MATCHES QUE NO CUMPLEN LAS REGLAS:');
      invalidMatches.forEach((m, idx) => {
        console.log(`\n  ${idx + 1}. Match ID: ${m.matchId}`);
        console.log(`     FM Ref: "${m.fmRef}"`);
        console.log(`     Bank Ref: "${m.bankRef}"`);
        console.log(`     Confidence: ${m.confidence.toFixed(3)}`);
        console.log(`     Criteria: ${JSON.stringify(m.criteria)}`);
        console.log(`     Reason: ${m.reason}`);
      });
    }

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkMatches();

