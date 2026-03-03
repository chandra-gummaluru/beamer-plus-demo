# Beamer+ PWA Setup

Beamer+ is now configured as a Progressive Web App (PWA), allowing users to install it on their devices and use it offline.

## What's Included

### 1. **manifest.json**
The web app manifest defines how Beamer+ appears when installed:
- App name, description, and icons
- Theme colors and display mode
- Start URL and orientation preferences

### 2. **service-worker.js**
The service worker enables offline functionality:
- Caches static assets (HTML, CSS, JS)
- Caches CDN dependencies (libraries, fonts)
- Network-first strategy for API calls
- Cache-first strategy for static files
- Graceful offline fallback

### 3. **Updated HTML Files**
Both `index.html` and `viewer.html` now include:
- PWA meta tags and viewport settings
- Manifest link
- iOS PWA support meta tags
- Service worker registration
- Install prompt handling

### 4. **Icons**
PWA icons are located in `/static/icons/` with sizes:
- 16×16, 32×32, 72×72, 96×96, 128×128, 144×144, 152×152, 192×192, 384×384, 512×512

## Generating Icons

### Option 1: Python Script (Recommended)
```bash
cd static/icons
pip install pillow
python generate_icons.py
```

### Option 2: HTML Generator
Open `static/icons/generate-icons.html` in a browser to auto-download all icons.

### Option 3: Custom Design
Replace the generated icons with your own custom-designed icons. Make sure to maintain the same filenames and sizes.

## Installation

### Desktop (Chrome/Edge)
1. Visit your Beamer+ site
2. Click the install icon in the address bar (⊕)
3. Click "Install" in the popup

### Mobile (Android)
1. Visit your Beamer+ site
2. Tap the browser menu (⋮)
3. Select "Install app" or "Add to Home Screen"

### Mobile (iOS)
1. Visit your Beamer+ site in Safari
2. Tap the Share button
3. Select "Add to Home Screen"
4. Tap "Add"

## Features

### Offline Support
- Static assets are cached automatically
- Presentations remain accessible offline once loaded
- API calls fall back to cache when offline

### App-like Experience
- Standalone display mode (no browser UI)
- Custom splash screen
- Native-like navigation
- Full-screen presentation mode

### Performance
- Instant loading of cached assets
- Background updates for new versions
- Optimized caching strategies

## Testing

### Local Testing
1. Serve the app over HTTPS (required for PWA)
   - Use `ngrok` or similar tunneling service
   - Or configure your local server with SSL
2. Open Chrome DevTools
3. Go to Application > Manifest to verify configuration
4. Go to Application > Service Workers to check registration

### PWA Checklist
- ✅ Manifest file with required fields
- ✅ Service worker registered
- ✅ Served over HTTPS
- ✅ Icons provided (multiple sizes)
- ✅ Viewport meta tag
- ✅ Theme color defined
- ✅ Install prompt handled

## Deployment Notes

### HTTPS Requirement
PWAs require HTTPS in production. Make sure your server is configured with SSL/TLS.

### Service Worker Scope
The service worker is registered at the root (`/`), giving it access to all routes.

### Caching Strategy
- **Static assets**: Cache-first (instant loading)
- **API calls**: Network-first (fresh data, cache fallback)
- **CDN resources**: Cached on install

### Updates
When you update the app:
1. Update the cache version in `service-worker.js` (e.g., `v1` → `v2`)
2. The service worker will automatically update
3. Users will get the new version on their next visit

## Customization

### Changing App Name/Colors
Edit `manifest.json`:
```json
{
  "name": "Your App Name",
  "theme_color": "#your-color",
  "background_color": "#your-color"
}
```

### Modifying Cache Strategy
Edit `service-worker.js` to adjust caching behavior for specific routes or file types.

### Adding More Assets to Cache
Add paths to the `STATIC_ASSETS` array in `service-worker.js`:
```javascript
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/your-new-file.html',
  // ...
];
```

## Troubleshooting

### Service Worker Not Registering
- Ensure you're serving over HTTPS (or localhost)
- Check browser console for errors
- Verify `service-worker.js` path is correct

### Icons Not Showing
- Generate icons using provided scripts
- Verify icon paths in `manifest.json`
- Clear browser cache and reinstall

### Changes Not Appearing
- Update cache version in `service-worker.js`
- Unregister old service worker in DevTools
- Clear browser cache
- Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)

### Install Prompt Not Showing
- Verify all PWA requirements are met
- Check that the app isn't already installed
- Review DevTools Application > Manifest for warnings

## Browser Support

- **Chrome/Edge**: Full support
- **Firefox**: Full support
- **Safari**: Limited support (no install prompt on desktop)
- **iOS Safari**: Add to Home Screen available

## Resources

- [PWA Documentation](https://web.dev/progressive-web-apps/)
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Web App Manifest](https://developer.mozilla.org/en-US/docs/Web/Manifest)
