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
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    return encryptedText; 
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
  
  // Decrypt document fields
  if (helperData.aadharCard) helperData.aadharCard = decrypt(helperData.aadharCard);
  if (helperData.addressProof) helperData.addressProof = decrypt(helperData.addressProof);
  if (helperData.drivingLicense) helperData.drivingLicense = decrypt(helperData.drivingLicense);
  
  return helperData;
};

module.exports = {
  encrypt,
  decrypt,
  encryptDocuments,
  decryptDocuments,
  decryptHelperData
};
