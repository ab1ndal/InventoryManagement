import { google } from 'googleapis';

// Initialize Google Drive API
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH || 'credentials.json',
  scopes: ['https://www.googleapis.com/auth/drive'],
});

const drive = google.drive({ version: 'v3', auth });

// Base folder ID for the product structure
const BASE_FOLDER_ID = '1Y_cqaTEWUz6_tZgivTXPd20Vx7eoou48';

async function findOrCreateFolder(name, parentId) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
  });

  if (res.data.files.length > 0) return res.data.files[0].id;

  const file = await drive.files.create({
    resource: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });

  return file.data.id;
}

async function createProductFolder(categoryName, productId) {
  const categoryFolderId = await findOrCreateFolder(
    categoryName,
    BASE_FOLDER_ID
  );
  const productFolderId = await findOrCreateFolder(productId, categoryFolderId);

  await Promise.all([
    findOrCreateFolder(`${productId}_M`, productFolderId),
    findOrCreateFolder(`${productId}_O`, productFolderId),
    findOrCreateFolder(`${productId}_R`, productFolderId),
  ]);

  return `https://drive.google.com/drive/folders/${productFolderId}`;
}

export { createProductFolder };
