const mongoose = require('mongoose');
const Transaction = require('./src/models/Transaction');
const Match = require('./src/models/Match');

// Connect to MongoDB
mongoose.connect('mongodb://mongo:27017/bc_ow', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

async function debugDatabase() {
  try {
    console.log('Connected to MongoDB');
    
    // Check if there are any users
    const User = require('./src/models/User');
    const users = await User.find({}).lean();
    console.log(`\nTotal users in database: ${users.length}`);
    users.forEach(user => {
      console.log(`  User: ${user.username} (ID: ${user._id})`);
    });
    
    // Check files
    const File = require('./src/models/File');
    const files = await File.find({}).lean();
    console.log(`\nTotal files in database: ${files.length}`);
    files.forEach(file => {
      console.log(`  File: ${file.originalName} (ID: ${file._id}, User: ${file.userId})`);
    });
    
    // Get all transactions
    const allTransactions = await Transaction.find({}).lean();
    console.log(`\nTotal transactions in database: ${allTransactions.length}`);
    
    // Group by type
    const fuerzaTransactions = allTransactions.filter(t => t.type === 'fuerza_movil');
    const bankTransactions = allTransactions.filter(t => t.type === 'bank');
    
    console.log(`Fuerza Movil transactions: ${fuerzaTransactions.length}`);
    console.log(`Bank transactions: ${bankTransactions.length}`);
    
    // Show transactions by user
    if (users.length > 0) {
      const userId = users[0]._id;
      console.log(`\n=== TRANSACTIONS FOR USER ${users[0].username} ===`);
      
      const userTransactions = await Transaction.find({ userId }).lean();
      console.log(`User transactions: ${userTransactions.length}`);
      
      const userFuerzaTransactions = userTransactions.filter(t => t.type === 'fuerza_movil');
      const userBankTransactions = userTransactions.filter(t => t.type === 'bank');
      
      console.log(`User Fuerza Movil transactions: ${userFuerzaTransactions.length}`);
      console.log(`User Bank transactions: ${userBankTransactions.length}`);
      
      // Show sample transactions for this user
      if (userFuerzaTransactions.length > 0) {
        console.log('\n=== USER FUERZA MOVIL TRANSACTIONS ===');
        userFuerzaTransactions.slice(0, 3).forEach((tx, index) => {
          console.log(`\n${index + 1}. ID: ${tx._id}`);
          console.log(`   Reference: "${tx.reference}"`);
          console.log(`   Payment Reference: "${tx.paymentReference}"`);
          console.log(`   Amount: ${tx.amount}`);
          console.log(`   Paid Amount: ${tx.paidAmount}`);
          console.log(`   Description: "${tx.description}"`);
          console.log(`   Bank: "${tx.bank}"`);
          console.log(`   Date: ${tx.date}`);
        });
      }
      
      if (userBankTransactions.length > 0) {
        console.log('\n=== USER BANK TRANSACTIONS ===');
        userBankTransactions.slice(0, 3).forEach((tx, index) => {
          console.log(`\n${index + 1}. ID: ${tx._id}`);
          console.log(`   Reference: "${tx.reference}"`);
          console.log(`   Amount: ${tx.amount}`);
          console.log(`   Description: "${tx.description}"`);
          console.log(`   Date: ${tx.date}`);
        });
      }
    }
    
    // Show sample Fuerza Movil transactions
    console.log('\n=== SAMPLE FUERZA MOVIL TRANSACTIONS ===');
    fuerzaTransactions.slice(0, 5).forEach((tx, index) => {
      console.log(`\n${index + 1}. ID: ${tx._id}`);
      console.log(`   Reference: "${tx.reference}"`);
      console.log(`   Payment Reference: "${tx.paymentReference}"`);
      console.log(`   Amount: ${tx.amount}`);
      console.log(`   Paid Amount: ${tx.paidAmount}`);
      console.log(`   Description: "${tx.description}"`);
      console.log(`   Bank: "${tx.bank}"`);
      console.log(`   Date: ${tx.date}`);
      console.log(`   Client Code: "${tx.clientCode}"`);
      console.log(`   Client Name: "${tx.clientName}"`);
    });
    
    // Show sample Bank transactions
    console.log('\n=== SAMPLE BANK TRANSACTIONS ===');
    bankTransactions.slice(0, 5).forEach((tx, index) => {
      console.log(`\n${index + 1}. ID: ${tx._id}`);
      console.log(`   Reference: "${tx.reference}"`);
      console.log(`   Amount: ${tx.amount}`);
      console.log(`   Description: "${tx.description}"`);
      console.log(`   Date: ${tx.date}`);
      console.log(`   Transaction Type: "${tx.transactionType}"`);
    });
    
    // Check for potential matches
    console.log('\n=== CHECKING FOR POTENTIAL MATCHES ===');
    let potentialMatches = 0;
    
    for (const fuerzaTx of fuerzaTransactions.slice(0, 10)) { // Check first 10
      for (const bankTx of bankTransactions.slice(0, 10)) { // Against first 10
        // Check reference matches
        if (fuerzaTx.paymentReference && bankTx.reference) {
          const fuerzaRef = fuerzaTx.paymentReference.toString().trim().toUpperCase();
          const bankRef = bankTx.reference.toString().trim().toUpperCase();
          
          if (fuerzaRef === bankRef || bankRef.includes(fuerzaRef) || fuerzaRef.includes(bankRef)) {
            console.log(`\nPOTENTIAL REFERENCE MATCH:`);
            console.log(`  Fuerza ID: ${fuerzaTx._id}`);
            console.log(`  Fuerza Payment Ref: "${fuerzaTx.paymentReference}"`);
            console.log(`  Bank ID: ${bankTx._id}`);
            console.log(`  Bank Ref: "${bankTx.reference}"`);
            potentialMatches++;
          }
        }
        
        // Check amount matches
        const fuerzaAmount = fuerzaTx.paidAmount || fuerzaTx.amount;
        const amountDiff = Math.abs(fuerzaAmount - bankTx.amount);
        const amountTolerance = Math.max(fuerzaAmount * 0.05, 1);
        
        if (amountDiff <= amountTolerance) {
          console.log(`\nPOTENTIAL AMOUNT MATCH:`);
          console.log(`  Fuerza ID: ${fuerzaTx._id}`);
          console.log(`  Fuerza Amount: ${fuerzaAmount}`);
          console.log(`  Bank ID: ${bankTx._id}`);
          console.log(`  Bank Amount: ${bankTx.amount}`);
          console.log(`  Difference: ${amountDiff}`);
          potentialMatches++;
        }
      }
    }
    
    console.log(`\nFound ${potentialMatches} potential matches in sample`);
    
    // Check existing matches
    const existingMatches = await Match.find({}).lean();
    console.log(`\nExisting matches in database: ${existingMatches.length}`);
    
    if (existingMatches.length > 0) {
      console.log('\n=== EXISTING MATCHES ===');
      existingMatches.slice(0, 5).forEach((match, index) => {
        console.log(`\n${index + 1}. Match Type: ${match.matchType}`);
        console.log(`   Confidence: ${match.confidence}`);
        console.log(`   Fuerza Transaction ID: ${match.fuerzaTransactionId}`);
        console.log(`   Bank Transaction ID: ${match.bankTransactionId}`);
        console.log(`   Criteria:`, match.criteria);
      });
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    mongoose.connection.close();
  }
}

debugDatabase();
