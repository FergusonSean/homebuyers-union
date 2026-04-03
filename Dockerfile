FROM nginx:alpine
COPY index.html donors.html style.css calculator.js /usr/share/nginx/html/
COPY assets/ /usr/share/nginx/html/assets/
EXPOSE 80
