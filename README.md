# Trading Assistant G

React + TypeScript + Vite trading dashboard.

## Source layout
The source archive is stored in nine ordered base64 segments named `trading-assistant-g-source-part-01.b64` through `trading-assistant-g-source-part-09.b64`. The GitHub Actions workflow joins, decodes, and extracts those segments before building.

## Local run
Reconstruct the archive by concatenating the nine `.b64` files in filename order, base64-decoding the result, and extracting the resulting `.tar.xz`. Then run `npm install` and `npm run dev`.

## Deployment
GitHub Actions builds the Vite app and publishes it to GitHub Pages on pushes to `main`.

> Market data is illustrative/demo data where a live feed is unavailable. The dashboard does not connect to a broker or submit trades. The scanner checklist is manually confirmed; it is not an autonomous trading signal.
