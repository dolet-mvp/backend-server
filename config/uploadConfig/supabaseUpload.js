require("dotenv").config();
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const supabase = require("../supabaseConfig/supabase");

const BUCKET_NAME = process.env.SUPABASE_BUCKET;

const storage = multer.memoryStorage();
const upload = multer({ storage });

const uploadToSupabase = async (file) => {
  if (!file) return null;

  const fileExt = path.extname(file.originalname);
  const fileName = `${uuidv4()}${fileExt}`;

  console.log(`Uploading to bucket: ${BUCKET_NAME}, filename: ${fileName}`);

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(fileName, file.buffer, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.mimetype,
    });

  if (error) {
    console.error("Supabase upload error:", error);
    throw new Error(`Upload failed: ${error.message}`);
  }

  const { data: urlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(fileName);
  return urlData.publicUrl;
};

const singleUpload = (fieldName) => [
  upload.single(fieldName),
  async (req, res, next) => {
    try {
      if (req.file) {
        req.fileUrl = await uploadToSupabase(req.file);
      }
      next();
    } catch (err) {
      next(err);
    }
  },
];

const multipleUpload = (fieldName, maxCount = 5) => [
  upload.array(fieldName, maxCount),
  async (req, res, next) => {
    try {
      if (req.files && req.files.length > 0) {
        req.fileUrls = await Promise.all(
          req.files.map((file) => uploadToSupabase(file))
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  },
];

const fieldsUpload = (fields) => [
  upload.fields(fields),
  async (req, res, next) => {
    try {
      if (req.files) {
        req.fileUrls = {};
        for (const fieldName in req.files) {
          const filesArray = req.files[fieldName];
          if (filesArray && filesArray.length > 0) {
            if (filesArray.length === 1) {
              req.fileUrls[fieldName] = await uploadToSupabase(filesArray[0]);
            } else {
              req.fileUrls[fieldName] = await Promise.all(
                filesArray.map((file) => uploadToSupabase(file))
              );
            }
          }
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  },
];

module.exports = { single: singleUpload, array: multipleUpload, fields: fieldsUpload };
