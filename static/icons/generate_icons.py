"""
Generate PWA icons for Beamer+
Requires: pip install pillow
"""
from PIL import Image, ImageDraw, ImageFont
import os

def generate_icon(size, output_path):
    """Generate a single icon of the specified size"""
    # Create image with dark background
    img = Image.new('RGB', (size, size), color='#333333')
    draw = ImageDraw.Draw(img)
    
    # Try to use a system font, fallback to default
    try:
        font_size = int(size * 0.5)
        font = ImageFont.truetype("arial.ttf", font_size)
    except:
        try:
            font = ImageFont.truetype("Arial.ttf", int(size * 0.5))
        except:
            font = ImageFont.load_default()
    
    # Draw "B+" text
    text = "B+"
    
    # Get text bounding box for centering
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    # Calculate position to center text
    x = (size - text_width) // 2 - bbox[0]
    y = (size - text_height) // 2 - bbox[1]
    
    # Draw text
    draw.text((x, y), text, fill='#ffffff', font=font)
    
    # Save image
    img.save(output_path, 'PNG')
    print(f"Generated: {output_path}")

def main():
    """Generate all required PWA icons"""
    # Icon sizes needed for PWA
    sizes = [16, 32, 72, 96, 128, 144, 152, 192, 384, 512]
    
    # Get the script directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    print("Generating Beamer+ PWA icons...")
    
    for size in sizes:
        output_path = os.path.join(script_dir, f'icon-{size}x{size}.png')
        generate_icon(size, output_path)
    
    print(f"\nAll icons generated successfully!")
    print(f"Location: {script_dir}")
    print("\nNote: You can replace these with custom-designed icons if desired.")

if __name__ == '__main__':
    main()
