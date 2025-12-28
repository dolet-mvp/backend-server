const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const IV_LENGTH = 16;

const getKey = () => {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (64 hex characters)');
  }
  return key;
};


const encrypt = (text) => {
  if (!text) return null;
  
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Return IV + encrypted text (IV is needed for decryption)
    return iv.toString('hex') + ':' + encrypted;
  } catch (error) {
    console.error('Encryption error:', error);
    return null;
  }
};


const decrypt = (encryptedText) => {
  if (!encryptedText) return null;
  
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) {
      return encryptedText; // Return as-is if not encrypted format
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    
    // Validate IV length
    if (iv.length !== IV_LENGTH) {
      console.warn('⚠️ Invalid IV length, returning null');
      return null;
    }
    
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    // Silently return null for invalid encrypted data
    return null; 
  }
};


const encryptDocuments = (documents) => {
  if (!documents) return documents;
  
  const encrypted = {};
  for (const [key, value] of Object.entries(documents)) {
    encrypted[key] = value ? encrypt(value) : value;
  }
  return encrypted;
};


const decryptDocuments = (documents) => {
  if (!documents) return documents;
  
  const decrypted = {};
  for (const [key, value] of Object.entries(documents)) {
    decrypted[key] = value ? decrypt(value) : value;
  }
  return decrypted;
};


const decryptHelperData = (helper) => {
  if (!helper) return helper;
  
  const helperData = helper.toJSON ? helper.toJSON() : helper;
  
  // Decrypt document fields - return null if decryption fails
  try {
    if (helperData.aadharCardDocument) {
      helperData.aadharCardDocument = decrypt(helperData.aadharCardDocument);
    }
    if (helperData.addressProofDocument) {
      helperData.addressProofDocument = decrypt(helperData.addressProofDocument);
    }
    if (helperData.drivingLicenseDocument) {
      helperData.drivingLicenseDocument = decrypt(helperData.drivingLicenseDocument);
    }
  } catch (error) {
    // Silently handle decryption errors for individual fields
    console.warn('⚠️ Failed to decrypt some helper documents');
  }
  
  return helperData;
};

module.exports = {
  encrypt,
  decrypt,
  encryptDocuments,
  decryptDocuments,
  decryptHelperData
};
