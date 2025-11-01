const Transaction = require('../models/Transaction');
const Match = require('../models/Match');

class OptimizedTransactionService {
  constructor() {
    // Sin dependencias de ML
  }

  /**
   * Algoritmo optimizado de matching en 3 fases (SIN MACHINE LEARNING)
   * Fase 1: Matching por referencia (prioridad alta)
   * Fase 2: Matching por monto + fecha (solo si no hay referencia)
   * Fase 3: Matching por descripción simple (solo casos especiales)
   */
  async findMatchesOptimized(userId, fuerzaTransactions, bankTransactions) {
    console.log(`Starting optimized matching for ${fuerzaTransactions.length} FuerzaMovil and ${bankTransactions.length} bank transactions`);
    
    const matches = [];
    const usedBankTxIds = new Set();
    const usedFuerzaTxIds = new Set();

    // FASE 1: Matching por referencia (CRITERIO PRINCIPAL)
    console.log('Phase 1: Reference-based matching');
    const referenceMatches = await this.findReferenceMatches(
      fuerzaTransactions, 
      bankTransactions, 
      usedBankTxIds, 
      usedFuerzaTxIds
    );
    matches.push(...referenceMatches);
    console.log(`Phase 1 completed: ${referenceMatches.length} matches found`);

    // FASE 2: Matching por monto + fecha (solo transacciones no emparejadas)
    console.log('Phase 2: Amount + Date matching');
    const remainingFuerza = fuerzaTransactions.filter(tx => !usedFuerzaTxIds.has(tx._id.toString()));
    const remainingBank = bankTransactions.filter(tx => !usedBankTxIds.has(tx._id.toString()));
    
    const amountDateMatches = await this.findAmountDateMatches(
      remainingFuerza, 
      remainingBank, 
      usedBankTxIds, 
      usedFuerzaTxIds
    );
    matches.push(...amountDateMatches);
    console.log(`Phase 2 completed: ${amountDateMatches.length} matches found`);

    // FASE 3: Descripción simple (sin ML)
    console.log('Phase 3: Description-based matching (simple text)');
    const finalFuerza = fuerzaTransactions.filter(tx => !usedFuerzaTxIds.has(tx._id.toString()));
    const finalBank = bankTransactions.filter(tx => !usedBankTxIds.has(tx._id.toString()));
    
    const descriptionMatches = await this.findDescriptionMatches(
      finalFuerza,
      finalBank,
      usedBankTxIds, 
      usedFuerzaTxIds
    );
    matches.push(...descriptionMatches);
    console.log(`Phase 3 completed: ${descriptionMatches.length} matches found`);

    // Preparar matches para guardar
    const matchesToSave = matches.map(match => ({
      userId,
      fuerzaTransactionId: match.fuerzaTransactionId,
      bankTransactionId: match.bankTransactionId,
      confidence: match.confidence,
      matchType: match.matchType,
      criteria: match.criteria,
      amountDifference: match.amountDifference,
      dateDifference: match.dateDifference
    }));

    console.log(`Total matches found: ${matchesToSave.length}`);
    return matchesToSave;
  }

  /**
   * FASE 1: Matching por referencia
   * Lógica: referencia FuerzaMovil debe ser subcadena de referencia bancaria
   */
  async findReferenceMatches(fuerzaTransactions, bankTransactions, usedBankTxIds, usedFuerzaTxIds) {
    const matches = [];
    let debugChecked = 0;
    let debugSkipped = 0;
    let debugNoRef = 0;

    for (const fuerzaTx of fuerzaTransactions) {
      // Try main reference, paymentReference, and invoice number
      const fmMainRef = (fuerzaTx.reference && fuerzaTx.reference.replace(/[^\d]/g, '')) || '';
      const fmPaymentRef = (fuerzaTx.paymentReference && fuerzaTx.paymentReference.toString().replace(/[^\d]/g, '')) || '';
      const fmInvoiceNumber = (fuerzaTx.invoiceNumber && fuerzaTx.invoiceNumber.replace(/[^\d]/g, '')) || '';
      
      // Need at least one valid reference (4+ digits)
      if ((!fmMainRef || fmMainRef.length < 4) && 
          (!fmPaymentRef || fmPaymentRef.length < 4) && 
          (!fmInvoiceNumber || fmInvoiceNumber.length < 4)) {
        debugNoRef++;
        continue;
      }

      // Buscar transacciones bancarias que contengan la referencia de FuerzaMovil
      // Check multiple matching strategies with both main ref and payment ref
      // Also check in bank transaction description field (references often appear there)
      const candidateBankTxs = bankTransactions.filter(bankTx => {
        if (usedBankTxIds.has(bankTx._id.toString())) {
          return false;
        }
        
        // Check bank reference field (if exists)
        const bankRef = (bankTx.reference && bankTx.reference.replace(/[^\d]/g, '')) || '';
        // Extract digits from bank description
        const bankDescDigits = (bankTx.description && bankTx.description.replace(/[^\d]/g, '')) || '';
        // Combine both for comprehensive search
        const bankAllDigits = bankRef + bankDescDigits;
        
        // Try matching with main reference
        if (fmMainRef.length >= 4) {
          // Check in reference field
          const matchResult = bankRef ? this.referencesMatch(fmMainRef, bankRef) : { matched: false, maxLength: 0 };
          if (matchResult.matched) {
            return true;
          }
          // Check in description digits
          const matchDesc = bankDescDigits ? this.referencesMatch(fmMainRef, bankDescDigits) : { matched: false, maxLength: 0 };
          if (matchDesc.matched) {
            return true;
          }
          // REMOVED: Check in combined digits (causes false positives)
          // The reference must be completely in bankRef OR bankDesc, not split across both
          // const matchCombined = bankAllDigits ? this.referencesMatch(fmMainRef, bankAllDigits) : { matched: false, maxLength: 0 };
          // if (matchCombined.matched) {
          //   return true;
          // }
        }
        
        // Try matching with payment reference ONLY if main reference doesn't exist or is invalid
        // CRITICAL: If mainRef exists and is valid (4+ digits), we MUST NOT use paymentRef
        // This prevents false positives where mainRef doesn't match but paymentRef accidentally matches
        // Example: mainRef "900823" doesn't match "10355942", but paymentRef "3559" accidentally matches
        // CRITICAL: paymentReference should ONLY be checked in bank reference field, NOT in description
        if (fmPaymentRef.length >= 4 && bankRef && bankRef.length >= 4) {
          // ONLY use paymentRef if mainRef doesn't exist or is invalid
          const mainRefIsInvalid = !fmMainRef || fmMainRef.length < 4;
          if (mainRefIsInvalid) {
            // ONLY check in bank reference field, not in description
            const matchResult = this.referencesMatch(fmPaymentRef, bankRef);
            if (matchResult.matched) {
              return true;
            }
          }
          // If mainRef exists and is valid, do NOT check paymentRef (prevents false positives)
        }
        
        // Try matching with invoice number ONLY if main reference doesn't exist or is invalid
        // CRITICAL: If main reference exists (4+ digits), we MUST NOT use invoice numbers
        // This prevents false positives where main ref doesn't match but invoice number coincidentally matches
        if (fmInvoiceNumber.length >= 4 && (!fmMainRef || fmMainRef.length < 4)) {
          // Check if Bank reference is contained in invoice number (like main ref matching)
          // BUT: invoice numbers in bank reference field should follow same rule: FM invoice must be in Bank
          const matchResult = bankRef ? this.referencesMatch(fmInvoiceNumber, bankRef) : { matched: false, maxLength: 0 };
          if (matchResult.matched) {
            return true;
          }
          
          // For descriptions: Check if FM invoice number (or substring) appears in Bank description
          // This is the reverse direction: FM invoice → Bank description
          // Example: FM invoice "1954" in Bank desc "NT 1954 GUAYANA"
          if (bankDescDigits) {
            // Check if FM invoice is contained in Bank description (reverse direction)
            if (bankDescDigits.includes(fmInvoiceNumber)) {
              return true;
            }
          }
          
          // Also check for significant substrings from invoice number
          // Try last 5 digits first (most specific), then last 4
          // This handles cases like "X00011954" where "1954" appears in description "NT 1954 GUAYANA"
          if (fmInvoiceNumber.length >= 5) {
            // Try last 5 digits first (more specific, less false positives)
            const invoiceSubstring5 = fmInvoiceNumber.slice(-5);
            // Check if FM invoice substring is in Bank description (reverse direction)
            // ONLY in bankDescDigits, NOT in bankAllDigits
            if (bankDescDigits && bankDescDigits.includes(invoiceSubstring5)) {
              return true;
            }
          }
          
          // Try last 4 digits if invoice is long enough
          if (fmInvoiceNumber.length >= 4) {
            const invoiceSubstring4 = fmInvoiceNumber.slice(-4);
            // Check with context validation to avoid false positives from amounts
            // Direction: FM invoice substring → Bank description (reverse)
            // ONLY in bankDescDigits, NOT in bankAllDigits
            if (bankDescDigits && this.referencesMatchInvoiceInDesc(invoiceSubstring4, bankDescDigits)) {
              return true;
            }
          }
        }
        
        return false;
      });

      debugChecked++;
      if (candidateBankTxs.length === 0) {
        debugSkipped++;
        // Log first few failures for debugging
        if (debugSkipped <= 5) {
          console.log(`🔍 No candidates for FM ref: "${fuerzaTx.reference}" (amount: ${fuerzaTx.amount || fuerzaTx.paidAmount})`);
        }
        continue;
      }

      // Para cada candidato, calcular score de matching
      for (const bankTx of candidateBankTxs) {
        const match = this.calculateReferenceMatch(fuerzaTx, bankTx);
        
        // Lower threshold for reference matches - was 0.6, now 0.5
        if (match.confidence >= 0.5) {
          let refUsed = fmMainRef;
          if (match.criteria.referenceMatch === 'payment_ref') {
            refUsed = fmPaymentRef;
          } else if (match.criteria.referenceMatch === 'invoice_number' || match.criteria.referenceMatch === 'invoice_number_substring') {
            refUsed = fmInvoiceNumber;
          }
          const matchLoc = match.criteria.matchLocation || 'unknown';
          console.log(`✅ Match found: FM main:"${fmMainRef}" payment:"${fmPaymentRef}" invoice:"${fmInvoiceNumber}" <-> Bank ref:"${bankTx.reference}" desc:"${(bankTx.description || '').substring(0, 50)}..." (conf: ${match.confidence.toFixed(2)}, used: ${match.criteria.referenceMatch}, location: ${matchLoc})`);
          matches.push({
            fuerzaTransactionId: fuerzaTx._id,
            bankTransactionId: bankTx._id,
            ...match
          });
          
          usedBankTxIds.add(bankTx._id.toString());
          usedFuerzaTxIds.add(fuerzaTx._id.toString());
          break; // Solo tomar el primer match por referencia
        } else {
          if (matches.length < 3) {
            console.log(`⚠️ Low confidence match rejected: FM "${fuerzaTx.reference}" <-> Bank "${bankTx.reference}" (conf: ${match.confidence.toFixed(2)})`);
          }
        }
      }
    }

    console.log(`📊 Reference matching stats: ${debugChecked} checked, ${debugSkipped} no candidates, ${debugNoRef} no valid reference`);
    return matches;
  }

  /**
   * FASE 2: Matching por monto + fecha
   * IMPORTANTE: Solo para transacciones sin referencia válida
   * CRITICAL: Reference matching is PRIMARY - amount matching is fallback only
   */
  async findAmountDateMatches(fuerzaTransactions, bankTransactions, usedBankTxIds, usedFuerzaTxIds) {
    const matches = [];

    for (const fuerzaTx of fuerzaTransactions) {
      // Use paidAmount if available (actual payment amount)
      const fuerzaAmount = fuerzaTx.paidAmount || fuerzaTx.amount;
      if (fuerzaAmount <= 0) continue; // Saltar transacciones sin monto

      // Extract references to verify NO reference match exists
      const fmMainRef = (fuerzaTx.reference && fuerzaTx.reference.replace(/[^\d]/g, '')) || '';
      const fmPaymentRef = (fuerzaTx.paymentReference && fuerzaTx.paymentReference.toString().replace(/[^\d]/g, '')) || '';
      
      // CRITICAL: Only use amount matching if there's NO valid reference to match
      // If FM has a reference (4+ digits), skip amount matching - reference is required
      if (fmMainRef.length >= 4) {
        // This transaction has a valid reference - should only match via reference
        continue; // Skip amount matching for transactions with valid references
      }

      // Buscar candidatos por monto (tolerancia más estricta cuando no hay referencia)
      // Los montos deben ser muy similares en magnitud
      const amountTolerance = Math.max(fuerzaAmount * 0.05, 5); // 5% o $5 mínimo (más estricto sin referencia)
      const candidateBankTxs = bankTransactions.filter(bankTx => {
        if (usedBankTxIds.has(bankTx._id.toString())) return false;
        
        // IMPORTANT: Also verify bank transaction has NO reference match possibility
        const bankRef = (bankTx.reference && bankTx.reference.replace(/[^\d]/g, '')) || '';
        // If bank has a reference (4+ digits), don't match by amount only
        // Reference matching should be primary
        if (bankRef.length >= 4) {
          return false; // Bank has reference - require reference match, not amount match
        }
        
        // Comparar valor absoluto del monto bancario con monto FuerzaMovil
        const bankAmountAbs = Math.abs(bankTx.amount || 0);
        if (bankAmountAbs === 0) return false;
        
        const amountDiff = Math.abs(fuerzaAmount - bankAmountAbs);
        return amountDiff <= amountTolerance;
      });

      if (candidateBankTxs.length === 0) continue;

      // Por ahora ignorar fechas ya que están mal parseadas
      // TODO: Arreglar el parsing de fechas en el futuro
      const dateFilteredCandidates = candidateBankTxs; // Sin filtro de fecha por ahora

      if (dateFilteredCandidates.length === 0) continue;

      // Sort candidates by amount difference to get best match
      const sortedCandidates = dateFilteredCandidates.sort((a, b) => {
        const diffA = Math.abs(fuerzaAmount - Math.abs(a.amount || 0));
        const diffB = Math.abs(fuerzaAmount - Math.abs(b.amount || 0));
        return diffA - diffB;
      });
      
      const bestMatch = sortedCandidates[0];
      const match = this.calculateAmountDateMatch(fuerzaTx, bestMatch);
      
      // Lower threshold for amount-based matches
      if (match.confidence >= 0.4) {
        matches.push({
          fuerzaTransactionId: fuerzaTx._id,
          bankTransactionId: bestMatch._id,
          ...match
        });
        
        usedBankTxIds.add(bestMatch._id.toString());
        usedFuerzaTxIds.add(fuerzaTx._id.toString());
      }
    }

    return matches;
  }

  /**
   * FASE 3: Matching por descripción (sin ML)
   * Solo para casos especiales usando comparación de texto simple
   */
  async findDescriptionMatches(fuerzaTransactions, bankTransactions, usedBankTxIds, usedFuerzaTxIds) {
    const matches = [];

    // Solo procesar transacciones que no tienen referencia válida y tienen monto
    // CRITICAL: Extract digits from reference to properly validate length
    const fuerzaWithoutRef = fuerzaTransactions.filter(tx => {
      if (usedFuerzaTxIds.has(tx._id.toString())) return false;
      if (tx.amount <= 0) return false;
      
      // Extract digits from reference
      const fmMainRef = (tx.reference && tx.reference.replace(/[^\d]/g, '')) || '';
      const fmPaymentRef = (tx.paymentReference && tx.paymentReference.toString().replace(/[^\d]/g, '')) || '';
      
      // Only use description matching if NO valid reference exists (neither main nor payment)
      // If there's a valid reference (4+ digits), it should match via reference, not description
      const hasValidMainRef = fmMainRef.length >= 4;
      const hasValidPaymentRef = fmPaymentRef.length >= 4;
      
      // Skip if has any valid reference
      if (hasValidMainRef || hasValidPaymentRef) {
        return false; // Has valid reference - should match via reference matching, not description
      }
      
      return true; // No valid reference - can try description matching
    });

    if (fuerzaWithoutRef.length === 0) return matches;

    // Buscar matches por descripción simple (sin ML)
    for (const fuerzaTx of fuerzaWithoutRef) {
      if (usedFuerzaTxIds.has(fuerzaTx._id.toString())) continue;

      // Buscar candidatos por palabras clave en la descripción
      const fuerzaKeywords = this.extractKeywords(fuerzaTx.description);
      
      for (const bankTx of bankTransactions) {
        if (usedBankTxIds.has(bankTx._id.toString())) continue;

        const bankKeywords = this.extractKeywords(bankTx.description);
        const keywordMatch = this.calculateKeywordSimilarity(fuerzaKeywords, bankKeywords);
        
        if (keywordMatch > 0.5) {
          const match = this.calculateDescriptionMatch(fuerzaTx, bankTx, keywordMatch);
          
          if (match.confidence >= 0.6) {
            matches.push({
              fuerzaTransactionId: fuerzaTx._id,
              bankTransactionId: bankTx._id,
              ...match
            });
            
            usedBankTxIds.add(bankTx._id.toString());
            usedFuerzaTxIds.add(fuerzaTx._id.toString());
            break; // Solo tomar el primer match
          }
        }
      }
    }

    return matches;
  }

  /**
   * Helper: Check if two references match
   * Rule: FM reference must be a COMPLETE SUBSTRING of Bank reference
   * The FM reference originates from Bank reference, so FM must be completely contained in Bank
   * Returns: Object with {matched: boolean, maxLength: number} where maxLength is the length of FM reference if matched
   * 
   * Example: 
   *   - Bank "1762007965831199" → FM "1762007" → ✅ Match (FM completo está contenido en Bank)
   *   - Bank "1762007965831199" → FM "5831199" → ✅ Match (FM completo está contenido en Bank)
   *   - Bank "1762007965831199" → FM "17620079663451274" → ❌ NO Match (FM tiene dígitos extra que no están en Bank)
   *   - Bank "00081059" → FM "081059" → ✅ Match (FM completo está contenido en Bank)
   *   - Bank "00081059" → FM "81059" → ✅ Match (FM completo está contenido en Bank)
   */
  referencesMatch(fmRef, bankRef) {
    if (!fmRef || !bankRef) return { matched: false, maxLength: 0 };
    
    // Clean references (remove asterisks, keep only digits)
    const fmRefCleaned = fmRef.replace(/[^\d]/g, '');
    const bankRefCleaned = bankRef.replace(/\*/g, '').replace(/[^\d]/g, '');
    
    if (fmRefCleaned.length < 4 || bankRefCleaned.length < 4) return { matched: false, maxLength: 0 };
    
    // CRITICAL RULE: FM reference must be completely contained in Bank reference
    // Bank is the original, FM is a substring of Bank
    // Check if the entire FM reference appears as a continuous substring in Bank
    if (bankRefCleaned.includes(fmRefCleaned)) {
      return {
        matched: true,
        maxLength: fmRefCleaned.length
      };
    }
    
    // If complete FM reference is not found, try checking if FM reference (without leading zeros) matches
    // This handles cases where Bank has "00081059" and FM has "081059" (with leading zero in FM)
    // But we still require the complete reference, just allowing for leading zero differences
    const fmRefNoLeadingZeros = fmRefCleaned.replace(/^0+/, '');
    if (fmRefNoLeadingZeros.length >= 4 && fmRefNoLeadingZeros !== fmRefCleaned) {
      // Only check if FM had leading zeros that we removed
      if (bankRefCleaned.includes(fmRefNoLeadingZeros)) {
        return {
          matched: true,
          maxLength: fmRefNoLeadingZeros.length
        };
      }
    }
    
    // No match - FM reference is not completely contained in Bank reference
    // OR FM has extra digits that don't exist in Bank
    return {
      matched: false,
      maxLength: 0
    };
  }

  /**
   * Helper: Check if invoice number substring appears in Bank description with context validation
   * Direction: FM invoice substring → Bank description (opposite of main reference matching)
   * This prevents false positives where invoice numbers match coincidentally within amounts
   * 
   * For invoice numbers like "1954", we need to check if it appears in meaningful context
   * like "NT 1954 GUAYANA" (not inside "39687534")
   */
  referencesMatchInvoiceInDesc(fmInvoiceSubstring, bankDescDigits) {
    if (!fmInvoiceSubstring || !bankDescDigits) return false;
    if (fmInvoiceSubstring.length < 4) return false;
    
    // Check if FM invoice substring is contained in Bank description
    if (!bankDescDigits.includes(fmInvoiceSubstring)) {
      return false;
    }
    
    const index = bankDescDigits.indexOf(fmInvoiceSubstring);
    
    // For short invoice substrings (4-5 digits) in long descriptions, validate context
    const isShortSequence = fmInvoiceSubstring.length <= 5;
    
    if (isShortSequence && bankDescDigits.length > 15) {
      // Check if match is near start or end (more likely to be a reference)
      const nearStart = index <= 3;
      const nearEnd = index + fmInvoiceSubstring.length >= bankDescDigits.length - 3;
      
      // If it's in the middle of a long sequence, check surrounding context
      if (!nearStart && !nearEnd) {
        // Additional check: if surrounded by digits on both sides, might be part of amount
        const before = index > 0 ? bankDescDigits[index - 1] : '';
        const after = index + fmInvoiceSubstring.length < bankDescDigits.length ? bankDescDigits[index + fmInvoiceSubstring.length] : '';
        
        // If both before and after are digits, and sequence is very short (4 digits), 
        // it's likely part of an amount - reject
        if (/\d/.test(before) && /\d/.test(after) && fmInvoiceSubstring.length === 4) {
          return false; // Reject: too likely to be embedded in amount
        }
      }
    }
    
    // Match found with proper context
    return true;
  }

  /**
   * Calcular match basado en referencia
   */
  calculateReferenceMatch(fuerzaTx, bankTx) {
    let confidence = 0;
    const criteria = {
      referenceMatch: true,
      amountMatch: false,
      dateMatch: false,
      embeddingSimilarity: 0
    };

    // Clean and get references
    const fmMainRef = (fuerzaTx.reference && fuerzaTx.reference.replace(/[^\d]/g, '')) || '';
    const fmPaymentRef = (fuerzaTx.paymentReference && fuerzaTx.paymentReference.toString().replace(/[^\d]/g, '')) || '';
    const fmInvoiceNumber = (fuerzaTx.invoiceNumber && fuerzaTx.invoiceNumber.replace(/[^\d]/g, '')) || '';
    const bankRef = (bankTx.reference && bankTx.reference.replace(/[^\d]/g, '')) || '';
    const bankDescDigits = (bankTx.description && bankTx.description.replace(/[^\d]/g, '')) || '';
    const bankAllDigits = bankRef + bankDescDigits;
    
    let usedRef = fmMainRef;
    let refMatchType = 'main_ref';
    let matchLocation = 'reference_field';

    // CRITICAL: Main reference must be checked FIRST
    // Payment reference should only be used when main reference doesn't exist or is invalid
    let matchFound = false;
    
    let maxMatchLength = 0; // Track longest matching sequence for confidence
    
    // PRIORITY 1: Check main reference first (most important)
    // Check main reference in bank reference field
    if (fmMainRef.length >= 4 && bankRef) {
      const matchResult = this.referencesMatch(fmMainRef, bankRef);
      if (matchResult.matched) {
        usedRef = fmMainRef;
        refMatchType = 'main_ref';
        matchLocation = 'reference_field';
        maxMatchLength = matchResult.maxLength;
        matchFound = true;
      }
    }
    // Check main reference in bank description
    if (!matchFound && fmMainRef.length >= 4 && bankDescDigits) {
      const matchResult = this.referencesMatch(fmMainRef, bankDescDigits);
      if (matchResult.matched) {
        usedRef = fmMainRef;
        refMatchType = 'main_ref';
        matchLocation = 'description_field';
        maxMatchLength = matchResult.maxLength;
        matchFound = true;
      }
    }
    // REMOVED: Check main reference in combined digits
    // This causes false positives when FM reference is partially in bankRef and partially in bankDesc
    // Example: FM "1300806" matches "1762007965829130080625125022" (combined) but is not really contained
    // We should ONLY match if the complete reference is in bankRef OR bankDesc, not across both
    // if (!matchFound && fmMainRef.length >= 4 && bankAllDigits) {
    //   const matchResult = this.referencesMatch(fmMainRef, bankAllDigits);
    //   if (matchResult.matched) {
    //     usedRef = fmMainRef;
    //     refMatchType = 'main_ref';
    //     matchLocation = 'combined_fields';
    //     maxMatchLength = matchResult.maxLength;
    //     matchFound = true;
    //   }
    // }
    // PRIORITY 2: Check payment reference ONLY if main reference doesn't exist or is invalid
    // CRITICAL RULE: If mainRef exists and is valid (4+ digits), we MUST NOT use paymentRef
    // If mainRef is valid but doesn't match, it means these are NOT the same transaction
    // Using paymentRef in this case causes false positives (e.g., "3559" matching "10355942" accidentally)
    // PaymentReference should ONLY be checked in bank reference field, NOT in description
    const mainRefIsInvalid = !fmMainRef || fmMainRef.length < 4;
    if (!matchFound && mainRefIsInvalid && fmPaymentRef.length >= 4 && bankRef && bankRef.length >= 4) {
      // ONLY check in bank reference field, not in description
      // This ensures paymentReference is actually a reference, not a coincidental match in dates/amounts
      const matchResult = this.referencesMatch(fmPaymentRef, bankRef);
      if (matchResult.matched) {
        usedRef = fmPaymentRef;
        refMatchType = 'payment_ref';
        matchLocation = 'reference_field';
        maxMatchLength = matchResult.maxLength;
        matchFound = true;
      }
    }
    // If mainRef exists and is valid but didn't match, do NOT try paymentRef (prevents false positives)
    // CRITICAL: Invoice numbers should ONLY be used if main reference doesn't exist or is invalid (< 4 digits)
    // If main reference exists (4+ digits), we MUST use it and cannot fall back to invoice numbers
    // This prevents false positives like "1002388" (main ref) matching "1762007965829164" via invoice number
    // when the main reference itself doesn't match
    const mainRefExistsAndIsValid = fmMainRef && fmMainRef.length >= 4;
    
    // Only use invoice numbers if main reference doesn't exist or is invalid
    // If main reference exists and is valid, we should NOT use invoice numbers
    const canUseInvoice = !mainRefExistsAndIsValid;
    
    // Check invoice number in bank reference field
    // ONLY if main reference doesn't exist or doesn't match
    if (!matchFound && canUseInvoice && fmInvoiceNumber.length >= 4 && bankRef) {
      const matchResult = this.referencesMatch(fmInvoiceNumber, bankRef);
      if (matchResult.matched) {
        usedRef = fmInvoiceNumber;
        refMatchType = 'invoice_number';
        matchLocation = 'reference_field';
        maxMatchLength = matchResult.maxLength;
        matchFound = true;
      }
    }
    // Check invoice number in bank description (invoice numbers often appear here)
    // ONLY if main reference doesn't exist or doesn't match
    if (!matchFound && canUseInvoice && fmInvoiceNumber.length >= 4 && bankDescDigits) {
      // Check if FM invoice number is completely contained in Bank description
      if (bankDescDigits.includes(fmInvoiceNumber)) {
        usedRef = fmInvoiceNumber;
        refMatchType = 'invoice_number';
        matchLocation = 'description_field';
        maxMatchLength = fmInvoiceNumber.length;
        matchFound = true;
      }
    }
    // REMOVED: Check invoice number in combined digits (causes false positives)
    // Only match if complete invoice number is in bankRef OR bankDesc, not across both
    // if (!matchFound && canUseInvoice && fmInvoiceNumber.length >= 6 && bankAllDigits) {
    //   if (bankAllDigits.includes(fmInvoiceNumber)) {
    //     usedRef = fmInvoiceNumber;
    //     refMatchType = 'invoice_number';
    //     matchLocation = 'combined_fields';
    //     maxMatchLength = fmInvoiceNumber.length;
    //     matchFound = true;
    //   }
    // }
    // Check invoice number substring (last 5+ digits, then last 4 if main ref didn't match)
    // This handles cases like "X00011954" where "1954" appears in description "NT 1954 GUAYANA"
    // Direction: FM invoice substring → Bank description
    // IMPORTANT: Only check in bankDescDigits, NOT in bankAllDigits to avoid false positives
    // ONLY if main reference doesn't exist or is invalid
    if (!matchFound && canUseInvoice && fmInvoiceNumber.length >= 5) {
      // Try last 5 digits first (more specific, less false positives)
      const invoiceSubstring5 = fmInvoiceNumber.slice(-5);
      // Only check in description digits, not combined (combined includes reference which could cause false matches)
      if (bankDescDigits && bankDescDigits.includes(invoiceSubstring5)) {
        // Use context validation to ensure it's not embedded in an amount
        if (this.referencesMatchInvoiceInDesc(invoiceSubstring5, bankDescDigits)) {
          usedRef = invoiceSubstring5;
          refMatchType = 'invoice_number_substring';
          matchLocation = 'description_field';
          maxMatchLength = invoiceSubstring5.length;
          matchFound = true;
        }
      }
      // DO NOT check in bankAllDigits here - too prone to false positives
    }
    
    // If main reference doesn't exist or is invalid, try last 4 digits of invoice number
    // IMPORTANT: Only if main reference doesn't exist (< 4 digits)
    // If main reference exists, we should NOT use invoice substrings
    // Direction: FM invoice substring → Bank description (with context validation)
    // IMPORTANT: Only check in bankDescDigits, NOT in bankAllDigits to avoid false positives
    if (!matchFound && canUseInvoice && fmInvoiceNumber.length >= 4) {
      // Only try last 4 if main reference didn't match (either doesn't exist or exists but didn't match)
      const invoiceSubstring4 = fmInvoiceNumber.slice(-4);
      // Only check in description digits with context validation
      if (bankDescDigits && this.referencesMatchInvoiceInDesc(invoiceSubstring4, bankDescDigits)) {
        usedRef = invoiceSubstring4;
        refMatchType = 'invoice_number_substring';
        matchLocation = 'description_field';
        maxMatchLength = invoiceSubstring4.length;
        matchFound = true;
      }
      // DO NOT check in bankAllDigits - this causes false positives like "1002388" matching "1762007965829164"
    }
    // Main reference checks were moved to PRIORITY 1 above
    // This section is now only for invoice number matching
    
    if (!matchFound) {
      // No match found at all
      return {
        confidence: 0,
        matchType: 'reference',
        criteria: { referenceMatch: false, amountMatch: false, dateMatch: false, embeddingSimilarity: 0 },
        amountDifference: 0,
        dateDifference: 0
      };
    }

    // Calculate confidence based on reference match
    // Rule: Bank reference must be contained in FM reference (or FM invoice in Bank description for invoices)
    if (matchLocation === 'reference_field') {
      // Exact match in reference field gets highest confidence
      if (usedRef === bankRef) {
        confidence = 0.95; // Exact match
      } else {
        confidence = 0.85; // Bank reference contained in FM reference field
      }
    } else if (matchLocation === 'description_field') {
      // For main/payment refs: Bank ref contained in FM ref found in description
      // For invoices: FM invoice contained in Bank description
      confidence = 0.80; // Reference match found in bank description
    } else if (matchLocation === 'combined_fields') {
      confidence = 0.75; // Combined fields (lowest)
    }
    
    // Bonus for longer references (more digits = more specific match)
    if (maxMatchLength >= 6) {
      confidence += 0.05; // Bonus for longer references
    }
    
    // Cap confidence at 1.0
    confidence = Math.min(confidence, 1.0);

    // Validate amounts, but be more lenient for reference matches
    // Since reference matching is the primary criterion, amounts are secondary
    const fuerzaAmount = fuerzaTx.paidAmount || fuerzaTx.amount || 0;
    const bankAmountAbs = Math.abs(bankTx.amount || 0);
    
    let amountDiff = 0;
    if (fuerzaAmount > 0 && bankAmountAbs > 0) {
      amountDiff = Math.abs(fuerzaAmount - bankAmountAbs);
      const amountTolerance = Math.max(fuerzaAmount * 0.10, 5); // 10% tolerance, min $5
      
      // For reference matches, we should NOT reject based on amount differences
      // Reference matching is primary - amounts might be parsed incorrectly or have different formats
      // Only use amounts to adjust confidence, not to reject matches
      
      // Bonus por monto similar - strict tolerance for reference matches
      if (amountDiff <= amountTolerance) {
        confidence += 0.1;
        criteria.amountMatch = true;
      } else if (amountDiff <= amountTolerance * 2) {
        // Still give small bonus for amounts that are reasonably close
        confidence += 0.05;
        criteria.amountMatch = false; // Mark as not matching, but don't reject
      } else {
        // Amounts are different, but don't reject the match
        // This could be due to parsing issues or different units
        criteria.amountMatch = false;
      }
      // Note: We removed the rejection logic - reference match is the primary criterion
    } else if (fuerzaAmount === 0 && bankAmountAbs === 0) {
      // Both zero - acceptable
      criteria.amountMatch = true;
    } else if ((fuerzaAmount === 0 && bankAmountAbs > 0) || (fuerzaAmount > 0 && bankAmountAbs === 0)) {
      // One is zero, other is not - be cautious but don't reject automatically
      // This could be valid in some cases (adjustments, etc.)
      criteria.amountMatch = false;
    }

    // Bonus por fecha cercana (use paymentDate if available)
    const fuerzaDate = fuerzaTx.paymentDate || fuerzaTx.date;
    let dateDiff = 0;
    if (fuerzaDate && bankTx.date) {
      dateDiff = Math.abs(new Date(fuerzaDate) - new Date(bankTx.date)) / (1000 * 60 * 60 * 24);
      if (dateDiff <= 3) {
        confidence += 0.05;
        criteria.dateMatch = true;
      }
    }

    return {
      confidence: Math.min(confidence, 1),
      matchType: 'reference',
      criteria: {
        ...criteria,
        referenceMatch: refMatchType, // Track which reference was used
        matchLocation: matchLocation // Track where the match was found
      },
      amountDifference: amountDiff / (fuerzaAmount || 1),
      dateDifference: dateDiff
    };
  }

  /**
   * Calcular match basado en monto + fecha
   */
  calculateAmountDateMatch(fuerzaTx, bankTx) {
    let confidence = 0;
    const criteria = {
      referenceMatch: false,
      amountMatch: false,
      dateMatch: false,
      embeddingSimilarity: 0
    };

    // Matching por monto (comparar valor absoluto del monto bancario)
    // Los montos deben ser muy similares en magnitud
    const bankAmountAbs = Math.abs(bankTx.amount);
    const amountDiff = Math.abs(fuerzaTx.amount - bankAmountAbs);
    const amountTolerance = Math.max(fuerzaTx.amount * 0.05, 5); // 5% o $5 mínimo
    
    if (amountDiff <= amountTolerance) {
      confidence += 0.9; // Muy alto peso para montos similares
      criteria.amountMatch = true;
    } else if (amountDiff <= amountTolerance * 2) {
      confidence += 0.6; // Peso medio para montos cercanos
    }

    // Matching por fecha (menos crítico)
    const dateDiff = Math.abs(fuerzaTx.date - bankTx.date) / (1000 * 60 * 60 * 24);
    if (dateDiff <= 7) {
      confidence += 0.2; // Menor peso para fechas
      criteria.dateMatch = true;
    } else if (dateDiff <= 30) {
      confidence += 0.1; // Bonus menor para fechas más lejanas
    }

    return {
      confidence: Math.min(confidence, 1),
      matchType: 'amount',
      criteria,
      amountDifference: amountDiff / (fuerzaTx.amount || 1),
      dateDifference: dateDiff
    };
  }

  /**
   * Calcular match basado en embeddings
   */
  calculateEmbeddingMatch(fuerzaTx, bankTx, similarity) {
    let confidence = similarity * 0.8; // Reducir peso de embeddings
    const criteria = {
      referenceMatch: false,
      amountMatch: false,
      dateMatch: false,
      embeddingSimilarity: similarity
    };

    // Bonus por monto similar
    const amountDiff = Math.abs(fuerzaTx.amount - bankTx.amount);
    const amountTolerance = Math.max(fuerzaTx.amount * 0.1, 1);
    
    if (amountDiff <= amountTolerance) {
      confidence += 0.1;
      criteria.amountMatch = true;
    }

    return {
      confidence: Math.min(confidence, 1),
      matchType: 'embedding',
      criteria,
      amountDifference: amountDiff / (fuerzaTx.amount || 1),
      dateDifference: Math.abs(fuerzaTx.date - bankTx.date) / (1000 * 60 * 60 * 24)
    };
  }

  /**
   * Extraer palabras clave de una descripción
   */
  extractKeywords(description) {
    if (!description) return [];
    
    // Limpiar y normalizar texto
    const cleanText = description.toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remover caracteres especiales
      .replace(/\s+/g, ' ')     // Normalizar espacios
      .trim();
    
    // Palabras comunes a ignorar
    const stopWords = ['el', 'la', 'de', 'del', 'en', 'con', 'por', 'para', 'a', 'al', 'y', 'o', 'un', 'una'];
    
    // Extraer palabras significativas
    const words = cleanText.split(' ')
      .filter(word => word.length > 2 && !stopWords.includes(word))
      .slice(0, 5); // Solo las primeras 5 palabras más importantes
    
    return words;
  }

  /**
   * Calcular similitud entre palabras clave
   */
  calculateKeywordSimilarity(keywords1, keywords2) {
    if (keywords1.length === 0 || keywords2.length === 0) return 0;
    
    const set1 = new Set(keywords1);
    const set2 = new Set(keywords2);
    
    // Calcular intersección
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    // Jaccard similarity
    return intersection.size / union.size;
  }

  /**
   * Calcular match basado en descripción
   */
  calculateDescriptionMatch(fuerzaTx, bankTx, keywordSimilarity) {
    let confidence = keywordSimilarity * 0.6; // Base por similitud de palabras
    const criteria = {
      referenceMatch: false,
      amountMatch: false,
      dateMatch: false,
      embeddingSimilarity: keywordSimilarity
    };

    // Bonus por monto similar
    const bankAmountAbs = Math.abs(bankTx.amount);
    const amountDiff = Math.abs(fuerzaTx.amount - bankAmountAbs);
    const amountTolerance = Math.max(fuerzaTx.amount * 0.1, 5);
    
    if (amountDiff <= amountTolerance) {
      confidence += 0.3;
      criteria.amountMatch = true;
    }

    return {
      confidence: Math.min(confidence, 1),
      matchType: 'description',
      criteria,
      amountDifference: amountDiff / (fuerzaTx.amount || 1),
      dateDifference: Math.abs(fuerzaTx.date - bankTx.date) / (1000 * 60 * 60 * 24)
    };
  }

  /**
   * Ejecutar matching optimizado para un usuario
   */
  async runOptimizedMatching(userId) {
    try {
      // Obtener transacciones del usuario
      const fuerzaTransactions = await Transaction.find({
        userId,
        type: 'fuerza_movil'
      }).lean();

      const bankTransactions = await Transaction.find({
        userId,
        type: 'bank'
      }).lean();

      if (fuerzaTransactions.length === 0 || bankTransactions.length === 0) {
        throw new Error('Need both Fuerza Movil and bank transactions to run matching');
      }

      // Eliminar matches existentes
      await Match.deleteMany({ userId });

      // Ejecutar matching optimizado
      const matches = await this.findMatchesOptimized(
        userId,
        fuerzaTransactions,
        bankTransactions
      );

      // Guardar matches
      if (matches.length > 0) {
        await Match.insertMany(matches);
      }

      return {
        success: true,
        matchesFound: matches.length,
        fuerzaTransactions: fuerzaTransactions.length,
        bankTransactions: bankTransactions.length
      };

    } catch (error) {
      console.error('Error in optimized matching:', error);
      throw error;
    }
  }
}

module.exports = new OptimizedTransactionService();
