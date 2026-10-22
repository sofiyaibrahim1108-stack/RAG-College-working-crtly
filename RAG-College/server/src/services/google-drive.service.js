const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
} = require('../config/env');

const TOKEN_PATH = path.resolve(__dirname, '../../data/drive-tokens.json');
const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

// Mapping of supported Google Native types to export MIME types and file extensions
const GOOGLE_NATIVE_MAP = {
  'application/vnd.google-apps.document': {
    exportMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: '.docx',
    fileType: 'docx',
    label: 'Google Doc'
  },
  'application/vnd.google-apps.spreadsheet': {
    exportMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: '.xlsx',
    fileType: 'xlsx',
    label: 'Google Sheet'
  },
  'application/vnd.google-apps.presentation': {
    exportMimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ext: '.pptx',
    fileType: 'pptx',
    label: 'Google Slide'
  }
};

// Mapping of standard MIME types to file extensions
const STANDARD_MIME_MAP = {
  'application/pdf': { ext: '.pdf', fileType: 'pdf' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: '.docx', fileType: 'docx' },
  'application/msword': { ext: '.doc', fileType: 'doc' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: '.pptx', fileType: 'pptx' },
  'application/vnd.ms-powerpoint': { ext: '.ppt', fileType: 'ppt' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: '.xlsx', fileType: 'xlsx' },
  'application/vnd.ms-excel': { ext: '.xls', fileType: 'xls' },
  'text/plain': { ext: '.txt', fileType: 'txt' },
  'text/csv': { ext: '.csv', fileType: 'csv' }
};

const EXTENSION_TO_FILETYPE = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.doc': 'doc',
  '.pptx': 'pptx',
  '.ppt': 'ppt',
  '.xlsx': 'xlsx',
  '.xls': 'xls',
  '.csv': 'csv',
  '.txt': 'txt'
};

class GoogleDriveService {
  constructor() {
    this.oauth2Client = null;
    this.tokens = null;
    this.initClient();
  }

  initClient() {
    if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
      this.oauth2Client = new google.auth.OAuth2(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI
      );

      // Listen for token updates/refreshes
      this.oauth2Client.on('tokens', (newTokens) => {
        this.saveTokens(newTokens);
      });

      // Load saved tokens from disk if present
      this.loadSavedTokens();
    }
  }

  isConfigured() {
    return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
  }

  loadSavedTokens() {
    try {
      if (fs.existsSync(TOKEN_PATH)) {
        const data = fs.readFileSync(TOKEN_PATH, 'utf-8');
        this.tokens = JSON.parse(data);
        if (this.oauth2Client && this.tokens) {
          this.oauth2Client.setCredentials(this.tokens);
        }
      }
    } catch (err) {
      console.warn('[GoogleDriveService] Error loading saved tokens:', err.message);
      this.tokens = null;
    }
  }

  saveTokens(tokens) {
    try {
      const dir = path.dirname(TOKEN_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const merged = { ...this.tokens, ...tokens };
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2), 'utf-8');
      this.tokens = merged;
      if (this.oauth2Client) {
        this.oauth2Client.setCredentials(merged);
      }
    } catch (err) {
      console.warn('[GoogleDriveService] Error saving tokens to disk:', err.message);
    }
  }

  isAuthenticated() {
    if (!this.isConfigured() || !this.oauth2Client) return false;
    return Boolean(this.tokens && (this.tokens.access_token || this.tokens.refresh_token));
  }

  getAuthUrl(state = '') {
    if (!this.isConfigured()) {
      throw new Error('Google OAuth credentials not configured in environment (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)');
    }
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: DRIVE_SCOPES,
      state
    });
  }

  async handleCallback(code) {
    if (!this.isConfigured()) {
      throw new Error('Google OAuth credentials not configured');
    }
    const { tokens } = await this.oauth2Client.getToken(code);
    this.saveTokens(tokens);
    return { success: true };
  }

  disconnect() {
    this.tokens = null;
    if (this.oauth2Client) {
      this.oauth2Client.setCredentials({});
    }
    try {
      if (fs.existsSync(TOKEN_PATH)) {
        fs.unlinkSync(TOKEN_PATH);
      }
    } catch (err) {
      console.warn('[GoogleDriveService] Error removing token file:', err.message);
    }
    return { success: true, message: 'Google Drive disconnected' };
  }

  getDriveClient() {
    if (!this.isAuthenticated()) {
      throw new Error('Google Drive is not connected or authenticated');
    }
    return google.drive({ version: 'v3', auth: this.oauth2Client });
  }

  /**
   * Determine whether a MIME type or file extension is supported by our RAG system
   */
  isSupported(mimeType, filename = '') {
    if (GOOGLE_NATIVE_MAP[mimeType]) return true;
    if (STANDARD_MIME_MAP[mimeType]) return true;
    const ext = path.extname(filename).toLowerCase();
    return Boolean(EXTENSION_TO_FILETYPE[ext]);
  }

  /**
   * List files from user's Google Drive matching supported college document formats
   */
  async listFiles({ pageSize = 30, pageToken = null, search = '' } = {}) {
    const drive = this.getDriveClient();

    // Query non-trashed files
    const queryParts = ['trashed = false'];

    // If search term is specified, search by name contains
    if (search && search.trim()) {
      const escaped = search.replace(/'/g, "\\'");
      queryParts.push(`name contains '${escaped}'`);
    }

    // Supported MIME types filter
    const supportedMimes = [
      ...Object.keys(GOOGLE_NATIVE_MAP),
      ...Object.keys(STANDARD_MIME_MAP)
    ];
    const mimeQuery = supportedMimes.map((m) => `mimeType = '${m}'`).join(' or ');
    queryParts.push(`(${mimeQuery})`);

    const q = queryParts.join(' and ');

    const res = await drive.files.list({
      q,
      pageSize: Math.min(pageSize, 100),
      pageToken: pageToken || undefined,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink, iconLink)',
      orderBy: 'modifiedTime desc'
    });

    const rawFiles = res.data.files || [];
    const formattedFiles = rawFiles.map((f) => {
      let fileType = 'unknown';
      let isGoogleNative = false;

      if (GOOGLE_NATIVE_MAP[f.mimeType]) {
        fileType = GOOGLE_NATIVE_MAP[f.mimeType].fileType;
        isGoogleNative = true;
      } else if (STANDARD_MIME_MAP[f.mimeType]) {
        fileType = STANDARD_MIME_MAP[f.mimeType].fileType;
      } else {
        const ext = path.extname(f.name).toLowerCase();
        fileType = EXTENSION_TO_FILETYPE[ext] || 'other';
      }

      return {
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        fileType,
        isGoogleNative,
        size: f.size ? parseInt(f.size, 10) : null,
        modifiedTime: f.modifiedTime,
        webViewLink: f.webViewLink || null,
        iconLink: f.iconLink || null
      };
    });

    return {
      files: formattedFiles,
      nextPageToken: res.data.nextPageToken || null
    };
  }

  /**
   * Get single file metadata
   */
  async getFileMetadata(fileId) {
    if (!fileId) throw new Error('fileId is required');
    const drive = this.getDriveClient();
    const res = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, modifiedTime, size, webViewLink'
    });
    return res.data;
  }

  /**
   * Download or export a file from Google Drive into a local destination directory
   */
  async downloadFile(fileId, destDir) {
    if (!fileId) throw new Error('fileId is required');
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const drive = this.getDriveClient();
    const meta = await this.getFileMetadata(fileId);

    const isNative = Boolean(GOOGLE_NATIVE_MAP[meta.mimeType]);
    let targetFilename = meta.name;
    let exportMimeType = null;
    let resolvedFileType = 'pdf';

    if (isNative) {
      const nativeConfig = GOOGLE_NATIVE_MAP[meta.mimeType];
      exportMimeType = nativeConfig.exportMimeType;
      resolvedFileType = nativeConfig.fileType;
      // Append proper extension if missing
      if (!targetFilename.toLowerCase().endsWith(nativeConfig.ext)) {
        targetFilename += nativeConfig.ext;
      }
    } else {
      const ext = path.extname(meta.name).toLowerCase();
      resolvedFileType = EXTENSION_TO_FILETYPE[ext] || 'pdf';
    }

    // Sanitize filename to prevent directory traversal
    const safeName = path.basename(targetFilename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniquePrefix = `drive_${fileId}_${Date.now()}`;
    const localFilePath = path.join(destDir, `${uniquePrefix}_${safeName}`);
    const destStream = fs.createWriteStream(localFilePath);

    if (isNative) {
      // Export Google Native document into Microsoft Office / PDF format
      const res = await drive.files.export(
        { fileId, mimeType: exportMimeType },
        { responseType: 'stream' }
      );
      await new Promise((resolve, reject) => {
        res.data.pipe(destStream)
          .on('finish', resolve)
          .on('error', (err) => {
            if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
            reject(err);
          });
      });
    } else {
      // Download binary file
      const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
      );
      await new Promise((resolve, reject) => {
        res.data.pipe(destStream)
          .on('finish', resolve)
          .on('error', (err) => {
            if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
            reject(err);
          });
      });
    }

    const stats = fs.statSync(localFilePath);
    if (stats.size === 0) {
      if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
      throw new Error(`Downloaded file "${targetFilename}" is empty (0 bytes)`);
    }

    return {
      filePath: localFilePath,
      originalFilename: targetFilename,
      fileType: resolvedFileType,
      fileSize: stats.size,
      mimeType: meta.mimeType,
      exportMimeType,
      webViewLink: meta.webViewLink || null,
      modifiedTime: meta.modifiedTime ? new Date(meta.modifiedTime) : new Date(),
      isGoogleNative: isNative
    };
  }
}

// Export singleton
const googleDriveService = new GoogleDriveService();
module.exports = googleDriveService;
