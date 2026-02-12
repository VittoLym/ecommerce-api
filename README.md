# 🛒 Ecommerce Backend API

Backend profesional para una plataforma de ecommerce, diseñado con arquitectura escalable, manejo robusto de pagos y control de concurrencia.

El proyecto simula un entorno real de producción aplicando buenas prácticas de backend moderno.

---

## 📖 Overview

La API permite:

- Registro y autenticación de usuarios
- Gestión de productos
- Creación de órdenes
- Sistema de checkout
- Integración con sistema de pagos (webhooks)
- Manejo de stock concurrente
- Observabilidad con métricas y logging estructurado

---

## 🏗 Architecture

- Arquitectura modular (NestJS)
- Repositorios desacoplados
- Event-driven para procesamiento de pagos (BullMQ + Redis)
- Transacciones atómicas con Prisma
- Logging estructurado con Pino
- Métricas estilo Prometheus

---

## 🚀 Tech Stack

- Node.js
- NestJS
- Prisma ORM
- PostgreSQL
- Redis
- BullMQ
- Pino
- Prometheus (metrics)

---

## 🔐 Features

### 🛒 Orders
- Creación de órdenes
- Cálculo automático de totalPrice
- Control de stock seguro

### 💳 Payments
- PaymentAttempt por orden
- Webhook validation
- Procesamiento asíncrono
- Idempotencia
- Restauración automática de stock si falla

### 📊 Observability
- Logging estructurado
- Correlation ID
- Métricas de negocio
- Métricas de rendimiento

---

## 🧠 Payment Flow

1. Usuario crea orden
2. Se genera PaymentAttempt (PENDING)
3. Gateway envía webhook
4. Webhook encola evento
5. Worker procesa pago
6. Orden pasa a PAID o CANCELLED

---

## 🧪 Running Locally

```bash
npm install
npm run start:dev
```
---

## Requisitos

- PostgreSQL
- Redis

---

##📦 Environment Variables
```bash
DATABASE_URL=
REDIS_HOST=
REDIS_PORT=
PAYMENT_WEBHOOK_SECRET=
```
---

##📈 Metrics

Endpoint disponible:

```bash
GET /metrics
```
Compatible con Prometheus + Grafana.

---

## 📌 Future Improvements

- Expiración automática de órdenes PENDING
- Refund system
- Shipping lifecycle
- Admin dashboard
- Rate limiting
- Circuit breaker para pagos

---

## 📄 Licencia

MIT License.
---
