import React, { useState, useEffect } from 'react';
import { ImageIcon, Download, Trash2, ExternalLink, Loader2 } from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:5000').replace(/\/api\/?$/, '');

function getAuthenticatedImageUrl(imgId) {
  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('auth_token') ||
    localStorage.getItem('jwt');
  const cleanToken = token ? token.replace(/^"|"$/g, '') : '';
  return `${API_BASE}/api/images/${imgId}/file${cleanToken ? `?token=${encodeURIComponent(cleanToken)}` : ''}`;
}

export default function MediaLibraryView({ onToast }) {
  const [mediaItems, setMediaItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [previewItem, setPreviewItem] = useState(null);

  const fetchMediaLibrary = async () => {
    try {
      setIsLoading(true);
      const token =
        localStorage.getItem('token') ||
        localStorage.getItem('auth_token') ||
        localStorage.getItem('jwt');

      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token.replace(/^"|"$/g, '')}`;
      }

      const res = await fetch(`${API_BASE}/api/media-library`, { headers });
      const data = await res.json();
      if (res.ok && data.success) {
        setMediaItems(data.data || []);
      } else {
        if (onToast) onToast(data.message || 'Failed to load media library', 'error');
      }
    } catch (err) {
      console.error('Error fetching media library:', err);
      if (onToast) onToast('Failed to connect to media library', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMediaLibrary();
  }, []);

  // Direct Browser Download Fix (Prevents Windows "Select an app" prompt)
  const handleDownload = (item) => {
    try {
      const token =
        localStorage.getItem('token') ||
        localStorage.getItem('auth_token') ||
        localStorage.getItem('jwt');
      const cleanToken = token ? token.replace(/^"|"$/g, '') : '';
      const downloadUrl = `${API_BASE}/api/media-library/${item._id}/download${cleanToken ? `?token=${encodeURIComponent(cleanToken)}` : ''}`;

      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${item.caption || 'diagram'}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      if (onToast) onToast('Downloading image...', 'success');
    } catch (err) {
      console.error('Download error:', err);
      if (onToast) onToast('Failed to download image', 'error');
    }
  };

  const handleRemove = async (id) => {
    try {
      const token =
        localStorage.getItem('token') ||
        localStorage.getItem('auth_token') ||
        localStorage.getItem('jwt');

      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token.replace(/^"|"$/g, '')}`;
      }

      const res = await fetch(`${API_BASE}/api/media-library/${id}`, {
        method: 'DELETE',
        headers
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setMediaItems((prev) => prev.filter((item) => item._id !== id));
        if (onToast) onToast('Removed from media library', 'success');
      } else {
        if (onToast) onToast(data.message || 'Failed to remove item', 'error');
      }
    } catch (err) {
      console.error('Remove error:', err);
      if (onToast) onToast('Failed to remove item', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="auth-loading-screen" style={{ height: '70vh' }}>
        <Loader2 size={36} className="spin" style={{ color: 'var(--primary)' }} />
        <p className="auth-loading-text">Loading Media Library...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1300px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px', borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
        <div>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text)', margin: 0, letterSpacing: '-0.3px' }}>Media Library</h2>
          <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            View, download, and manage your saved diagrams and extracted visual assets.
          </p>
        </div>
        <div style={{ background: 'var(--bg-card)', padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>
          Total Saved: {mediaItems.length}
        </div>
      </div>

      {mediaItems.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 20px', background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border)' }}>
          <ImageIcon size={48} color="var(--text-muted)" style={{ marginBottom: '12px' }} />
          <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 6px 0' }}>No saved images yet</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0 }}>
            Click the bookmark icon on any diagram in your chat answers to save them here.
          </p>
        </div>
      ) : (
        /* Grid adjusted to medium size cards (minmax 220px instead of 280px) */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '20px' }}>
          {mediaItems.map((item) => {
            const imgId = item.imageId || item._id;
            const imageUrl = item.imageUrl || getAuthenticatedImageUrl(imgId);

            return (
              <div key={item._id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', transition: 'transform 0.15s ease' }}>
                {/* Image container height reduced to 140px for medium/compact look */}
                <div
                  style={{ height: '140px', background: '#0F1A30', cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
                  onClick={() => setPreviewItem(item)}
                >
                  <img
                    src={imageUrl}
                    alt={item.caption || 'Saved diagram'}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '6px' }}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', opacity: 0, transition: 'opacity 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF', gap: '6px', fontSize: '0.8rem', fontWeight: 600 }} className="image-hover-layer">
                    <ExternalLink size={14} />
                    <span>Zoom</span>
                  </div>
                </div>

                <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.caption || 'Diagram'}>
                      {item.caption || 'Extracted Diagram'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
                      {item.pageNumber ? `Page ${item.pageNumber}` : 'Saved Item'} • {new Date(item.savedAt).toLocaleDateString()}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
                    <button
                      type="button"
                      onClick={() => handleDownload(item)}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', padding: '6px 10px', background: 'var(--primary)', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      <Download size={13} />
                      <span>Download</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(item._id)}
                      title="Remove from library"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 10px', background: 'rgba(239, 68, 68, 0.1)', color: '#EF4444', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', cursor: 'pointer' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full Preview Modal */}
      {previewItem && (
        <div className="modal-backdrop" onClick={() => setPreviewItem(null)}>
          <div className="modal-container citation-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '750px' }}>
            <div className="modal-header-row">
              <h3 className="modal-header-title" style={{ fontSize: '1.15rem', margin: 0 }}>
                {previewItem.caption || 'Diagram Preview'}
              </h3>
              <button type="button" className="btn-modal-close-icon" onClick={() => setPreviewItem(null)}>
                ✕
              </button>
            </div>
            <div className="modal-content-body" style={{ textAlign: 'center', padding: '24px', background: '#0F1A30' }}>
              <img
                src={previewItem.imageUrl || getAuthenticatedImageUrl(previewItem.imageId || previewItem._id)}
                alt="Preview"
                style={{ maxWidth: '100%', maxHeight: '55vh', objectFit: 'contain', borderRadius: '6px' }}
              />
            </div>
            <div className="modal-footer-row" style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 24px' }}>
              <button
                type="button"
                onClick={() => handleDownload(previewItem)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 18px', background: 'var(--primary)', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
              >
                <Download size={15} />
                <span>Download Image</span>
              </button>
              <button type="button" className="btn-modal-cancel" onClick={() => setPreviewItem(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}