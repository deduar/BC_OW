# Bank Reconciliation Application

Aplicación de conciliación bancaria que permite emparejar transacciones de archivos de Fuerza Movil con movimientos bancarios usando embeddings de texto y aprendizaje por refuerzo.

## Arquitectura

La aplicación está construida como microservicios en contenedores Docker:

- **Frontend**: React + Nginx (puerto 3000)
- **Backend**: Node.js + Express (puerto 4000)
- **ML Service**: Python + FastAPI (puerto 5000)
- **Database**: MongoDB (puerto 27018)
- **File Storage**: MinIO (puerto 9000/9001)

## Requisitos

- Docker
- Docker Compose

## Instalación y Ejecución

1. Clona el repositorio
2. Ejecuta los contenedores:

```bash
docker compose up --build
```

3. Accede a la aplicación en http://localhost:3000

## Servicios

### Frontend
- Interfaz de usuario para subir archivos y revisar matches
- Construido con React y Material-UI

### Backend API
- Manejo de archivos y procesamiento
- Autenticación JWT
- Comunicación con servicios ML y almacenamiento

### ML Service
- Generación de embeddings con Sentence Transformers
- Cálculo de similitud coseno
- Reentrenamiento basado en feedback

### Base de Datos
- MongoDB con aislamiento por usuario
- Modelos: User, File, Transaction, Match, Feedback

## Desarrollo

Para desarrollo local:

```bash
# Construir y ejecutar servicios
docker compose up --build

# O ejecutar individualmente:
# Backend
cd backend && npm run dev

# Frontend
cd frontend && npm start

# ML Service
cd ml-service && python main.py
```

## Características

- ✅ Aislamiento multi-usuario
- ✅ Procesamiento de archivos XLSX, CSV, PDF
- ✅ Matching inteligente con embeddings
- ✅ Aprendizaje por refuerzo
- ✅ Interfaz web moderna
- ✅ Arquitectura de microservicios
- ✅ Contenedorización completa

## API Endpoints

- `POST /api/auth/login` - Login
- `POST /api/files/upload` - Subir archivo
- `GET /api/transactions` - Listar transacciones
- `POST /api/matches/run` - Ejecutar matching
- `GET /api/matches` - Obtener matches
- `POST /api/matches/{id}/feedback` - Enviar feedback