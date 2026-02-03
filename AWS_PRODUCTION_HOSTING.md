# 🚀 AWS Production Hosting Guide

Complete step-by-step guide to deploy RepoTrack on AWS EC2.

---

## 📋 Prerequisites

- AWS EC2 instance (Ubuntu 20.04+ recommended)
- Domain name (optional, for SSL)
- MongoDB Atlas account (or self-hosted MongoDB)
- Git repository access

---

## 🔧 Step 1: Initial Server Setup

### 1.1 Connect to Your EC2 Instance
```bash
ssh -i your-key.pem ubuntu@your-ec2-ip
```

### 1.2 Update System
```bash
sudo apt update && sudo apt upgrade -y
```

### 1.3 Install Required Software
```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 (Process Manager)
sudo npm install -g pm2

# Install serve (for frontend)
sudo npm install -g serve

# Install Nginx
sudo apt install nginx -y

# Install Git
sudo apt install git -y
```

### 1.4 Verify Installations
```bash
node --version    # Should show v18.x or higher
npm --version
pm2 --version
nginx -v
```

---

## 📥 Step 2: Clone and Setup Application

### 2.1 Clone Repository
```bash
cd /home/ubuntu
git clone https://github.com/crvcrv26/repo.git
cd repo
```

### 2.2 Install Dependencies
```bash
# Backend dependencies
npm install

# Frontend dependencies
cd frontend
npm install
cd ..
```

---

## ⚙️ Step 3: Environment Configuration

### 3.1 Backend Environment (.env)
```bash
nano .env
```

**Add these variables:**
```env
NODE_ENV=production
PORT=5000
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/repoapp
JWT_SECRET=your-super-strong-random-secret-key-minimum-32-characters
JWT_EXPIRE=7d
```

**Generate strong JWT_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3.2 Frontend Environment (frontend/.env)
```bash
cd frontend
nano .env
```

**Add:**
```env
VITE_API_URL=http://YOUR_EC2_PUBLIC_IP:5000/api
```

**Or if using domain:**
```env
VITE_API_URL=https://yourdomain.com/api
```

---

## 🏗️ Step 4: Build Frontend

```bash
cd frontend
npm run build
cd ..
```

**Verify build:**
```bash
ls -la frontend/dist/
```

---

## 🗄️ Step 5: Database Setup

```bash
# Create admin users
node script/create-admins.js

# Initialize file storage settings
node script/init-file-storage-settings.js
```

**Default Admin Credentials:**
- Super Super Admin: `supersuperadmin@example.com` / `SuperSuperAdmin123!`
- Super Admin: `superadmin@example.com` / `SuperAdmin123!`

**⚠️ Change these passwords immediately after first login!**

---

## 🔒 Step 6: Configure AWS Security Groups

In AWS Console → EC2 → Security Groups:

**Inbound Rules:**
- Port 22 (SSH) - Your IP only
- Port 80 (HTTP) - 0.0.0.0/0
- Port 443 (HTTPS) - 0.0.0.0/0
- Port 5000 (Backend) - Your IP only (or remove after Nginx setup)
- Port 3000 (Frontend) - Your IP only (or remove after Nginx setup)

---

## 🌐 Step 7: Configure Nginx

### 7.1 Create Nginx Configuration
```bash
sudo nano /etc/nginx/sites-available/repoapp
```

**Add this configuration:**
```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;  # Replace with your domain or use _ for any domain
    
    # Frontend - React App
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Backend API
    location /api {
        proxy_pass http://localhost:5000/api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Increase timeouts for large file uploads
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        client_max_body_size 50M;
    }
    
    # Health check
    location /health {
        proxy_pass http://localhost:5000/health;
        proxy_set_header Host $host;
    }
}
```

### 7.2 Enable Configuration
```bash
# Create symbolic link
sudo ln -s /etc/nginx/sites-available/repoapp /etc/nginx/sites-enabled/

# Remove default config
sudo rm /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
sudo systemctl enable nginx
```

---

## 🚀 Step 8: Start Application with PM2

### 8.1 Start Services
```bash
cd /home/ubuntu/repo

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on server reboot
pm2 startup
# Follow the command it outputs (usually: sudo env PATH=... pm2 startup systemd -u ubuntu --hp /home/ubuntu)
```

### 8.2 Verify Services
```bash
# Check status
pm2 status

# View logs
pm2 logs repotrack-backend
pm2 logs repotrack-frontend

# Monitor resources
pm2 monit
```

---

## 🔐 Step 9: Setup SSL/HTTPS (Optional but Recommended)

### 9.1 Install Certbot
```bash
sudo apt install certbot python3-certbot-nginx -y
```

### 9.2 Get SSL Certificate
```bash
# Replace with your domain
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

### 9.3 Auto-Renewal
```bash
# Test renewal
sudo certbot renew --dry-run

# Certbot automatically sets up renewal via cron
```

### 9.4 Update Frontend .env (if using HTTPS)
```bash
cd frontend
nano .env
```

**Update:**
```env
VITE_API_URL=https://your-domain.com/api
```

**Rebuild frontend:**
```bash
npm run build
cd ..
pm2 restart repotrack-frontend
```

---

## ✅ Step 10: Verify Deployment

### 10.1 Check Backend
```bash
curl http://localhost:5000/health
# Should return: {"status":"OK","message":"Repo App Backend is running",...}
```

### 10.2 Check Frontend
```bash
curl http://localhost:3000
# Should return HTML content
```

### 10.3 Check via Nginx
```bash
# If using domain
curl http://your-domain.com/health

# If using IP
curl http://YOUR_EC2_IP/health
```

### 10.4 Test in Browser
- Frontend: `http://your-domain.com` or `http://YOUR_EC2_IP`
- Backend API: `http://your-domain.com/api/health`
- Login: Use admin credentials created in Step 5

---

## 🔄 Step 11: Update Application

### 11.1 Pull Latest Changes
```bash
cd /home/ubuntu/repo
git pull origin main
```

### 11.2 Update Dependencies
```bash
npm install
cd frontend
npm install
cd ..
```

### 11.3 Rebuild Frontend
```bash
cd frontend
npm run build
cd ..
```

### 11.4 Restart Services
```bash
pm2 restart all
```

---

## 📊 Step 12: Monitoring & Maintenance

### 12.1 View Logs
```bash
# All logs
pm2 logs

# Backend only
pm2 logs repotrack-backend --lines 100

# Frontend only
pm2 logs repotrack-frontend --lines 100

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### 12.2 Check Resource Usage
```bash
# PM2 monitoring
pm2 monit

# System resources
htop
# or
free -h
df -h
```

### 12.3 Restart Services
```bash
# Restart all
pm2 restart all

# Restart specific service
pm2 restart repotrack-backend
pm2 restart repotrack-frontend

# Reload Nginx
sudo systemctl reload nginx
```

---

## 🛠️ Troubleshooting

### Issue: Services Not Starting
```bash
# Check PM2 logs
pm2 logs

# Check if ports are in use
sudo netstat -tlnp | grep -E ':(3000|5000)'

# Restart PM2
pm2 kill
pm2 start ecosystem.config.js
```

### Issue: Nginx 502 Bad Gateway
```bash
# Check if backend is running
pm2 status

# Check backend logs
pm2 logs repotrack-backend

# Restart backend
pm2 restart repotrack-backend

# Check Nginx error log
sudo tail -50 /var/log/nginx/error.log
```

### Issue: Frontend Not Loading
```bash
# Check if frontend is built
ls -la frontend/dist/

# Rebuild if needed
cd frontend
npm run build
cd ..

# Restart frontend
pm2 restart repotrack-frontend
```

### Issue: Database Connection Failed
```bash
# Check MongoDB URI in .env
cat .env | grep MONGODB_URI

# Test connection
node -e "require('dotenv').config(); const mongoose = require('mongoose'); mongoose.connect(process.env.MONGODB_URI).then(() => { console.log('Connected'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });"
```

### Issue: Out of Memory
```bash
# Check memory usage
free -h

# Restart with memory optimization
cd /home/ubuntu/repo
./restart-with-memory-optimization.sh
```

---

## 🔒 Security Checklist

- [ ] Changed default admin passwords
- [ ] Strong JWT_SECRET set (32+ characters)
- [ ] Security groups configured (only necessary ports open)
- [ ] SSL/HTTPS enabled (if using domain)
- [ ] Regular backups configured
- [ ] PM2 auto-restart enabled
- [ ] Nginx configured correctly
- [ ] Environment variables secured (.env not in git)

---

## 📝 Quick Reference Commands

```bash
# Start services
pm2 start ecosystem.config.js

# Stop services
pm2 stop all

# Restart services
pm2 restart all

# View status
pm2 status

# View logs
pm2 logs

# Monitor
pm2 monit

# Rebuild frontend
cd frontend && npm run build && cd ..

# Restart Nginx
sudo systemctl restart nginx

# Check Nginx config
sudo nginx -t

# View Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

---

## 🌍 Access URLs

**After setup, access your application:**

- **Frontend:** `http://your-domain.com` or `http://YOUR_EC2_IP`
- **Backend API:** `http://your-domain.com/api/health`
- **Admin Login:** `http://your-domain.com/login`

**With SSL:**
- **Frontend:** `https://your-domain.com`
- **Backend API:** `https://your-domain.com/api/health`

---

## 📞 Support

If you encounter issues:
1. Check PM2 logs: `pm2 logs`
2. Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`
3. Verify services: `pm2 status`
4. Test endpoints: `curl http://localhost:5000/health`

---

**✅ Your application is now live on AWS!**
