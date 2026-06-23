const cloudinary = require('cloudinary').v2;

function initCloudinary() {
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    console.warn('⚠️ Cloudinary env vars not set - screenshot uploads disabled');
    return false;
  }
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log('✅ Cloudinary initialized - screenshot uploads enabled');
  return true;
}

// Uploads a base64 or buffer image to Cloudinary, returns the secure URL
async function uploadImage(fileBuffer, folder = 'clashking-screenshots') {
  const b64 = fileBuffer.toString('base64');
  const dataUri = `data:image/jpeg;base64,${b64}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder,
    resource_type: 'image',
  });
  return result.secure_url;
}

module.exports = { initCloudinary, uploadImage };
