FROM nginx:alpine

COPY index.html /usr/share/nginx/html/index.html
COPY styles.css /usr/share/nginx/html/styles.css
COPY app.js /usr/share/nginx/html/app.js
COPY manifest.webmanifest /usr/share/nginx/html/manifest.webmanifest
COPY service-worker.js /usr/share/nginx/html/service-worker.js
COPY icon.svg /usr/share/nginx/html/icon.svg
