/**
 * User-Friendly Error Formatting Utility
 * Translates technical backend/network errors into human-friendly college assistant messages.
 */

export function getFriendlyErrorMessage(error, context = 'general') {
  if (!error) return 'Something went wrong. Please try again.';

  const rawMessage = typeof error === 'string' ? error : error.message || '';
  const lower = rawMessage.toLowerCase();

  // Log raw technical error for developer troubleshooting in console
  console.warn(`[App Notice - ${context}]:`, error);

  // Network / Connection / Server down
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('econnrefused') ||
    lower.includes('err_network') ||
    lower.includes('load failed') ||
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('504') ||
    lower.includes('internal server error')
  ) {
    if (context === 'chat') {
      return "Sorry, we couldn't generate your answer right now. Please try again later.";
    }
    return 'Unable to reach the college assistant server right now. Please ensure the local service is running and try again.';
  }

  // Google Drive Authentication & Access
  if (context === 'drive' || lower.includes('drive') || lower.includes('google') || lower.includes('oauth')) {
    if (lower.includes('access_denied') || lower.includes('denied') || lower.includes('consent') || lower.includes('cancelled')) {
      return 'Google Drive access was not completed. Please sign in again and allow access to your files.';
    }
    if (lower.includes('token') || lower.includes('unauthorized') || lower.includes('expired')) {
      return 'Google Drive session has expired. Please reconnect your account.';
    }
    if (lower.includes('configured') || lower.includes('client_id')) {
      return 'Google Drive integration is not configured. Please check your server setup.';
    }
    return "We couldn't connect to Google Drive. Please try connecting again.";
  }

  // Document Upload
  if (context === 'upload' || lower.includes('upload') || lower.includes('multer')) {
    if (lower.includes('supported') || lower.includes('format') || lower.includes('extension') || lower.includes('type')) {
      return "This file type isn't supported. Please upload PDF, Word, Excel, CSV, or PowerPoint documents.";
    }
    if (lower.includes('size') || lower.includes('large') || lower.includes('limit')) {
      return 'This file is too large to process. Please select a smaller document.';
    }
    return "We couldn't upload this document. Please check the file and try again.";
  }

  // Document Deletion
  if (context === 'delete-doc' || lower.includes('delete document')) {
    return "We couldn't delete this document. Please try again.";
  }

  // Department Management / Deletion
  if (context === 'delete-dept' || context === 'dept' || context === 'update-dept' || lower.includes('department')) {
    if (
      lower.includes('assigned to it') ||
      lower.includes('active documents') ||
      lower.includes('cannot delete department') ||
      lower.includes('cannot be deleted')
    ) {
      const match = rawMessage.match(/(\d+)\s+document/i);
      if (match && match[1]) {
        const count = match[1];
        return `This department can't be deleted because ${count} document${count === '1' ? '' : 's'} are assigned to it.`;
      }
      return 'This department cannot be deleted because documents are currently assigned to it.';
    }
    if (lower.includes('already exists')) {
      return rawMessage;
    }
    if (lower.includes('required')) {
      return 'Department name and code are required.';
    }
    return "We couldn't complete the department request. Please try again.";
  }

  // Chat Generation
  if (context === 'chat') {
    if (lower.includes('not found') || lower.includes('empty') || lower.includes('no answer')) {
      return "I couldn't find relevant information in your connected documents.";
    }
    return "Sorry, we couldn't generate your answer right now. Please try again later.";
  }

  // Fallback for clean errors
  if (rawMessage && !lower.includes('object') && !lower.includes('500') && !lower.includes('mongo') && !lower.includes('sql') && rawMessage.length < 120) {
    return rawMessage;
  }

  return 'Something went wrong. Please try again.';
}
