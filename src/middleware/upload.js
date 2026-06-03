const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const avatarStorage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'lernbruecke/avatars', allowed_formats: ['jpg','jpeg','png','webp'], transformation: [{ width: 400, height: 400, crop: 'fill' }] },
});

const fileStorage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'lernbruecke/chat-files', resource_type: 'auto' },
});

const uploadAvatar = multer({ storage: avatarStorage, limits: { fileSize: 5*1024*1024 } });
const uploadFile   = multer({ storage: fileStorage,   limits: { fileSize: 20*1024*1024 } });

module.exports = { uploadAvatar, uploadFile };