import sys
import fitz  # PyMuPDF

def render_page(pdf_path, page_num, output_path):
    try:
        doc = fitz.open(pdf_path)
        # Convert 1-based page index to 0-based
        p_idx = int(page_num) - 1
        if 0 <= p_idx < len(doc):
            page = doc[p_idx]
            pix = page.get_pixmap(dpi=150)
            pix.save(output_path)
            print("OK")
        else:
            print("PAGE_OUT_OF_RANGE")
    except Exception as e:
        print(f"ERROR: {str(e)}")

if __name__ == "__main__":
    if len(sys.argv) >= 4:
        render_page(sys.argv[1], sys.argv[2], sys.argv[3])