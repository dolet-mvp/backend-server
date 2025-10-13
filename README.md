# Dolet App Backend Server

A Node.js/Express backend server for the Dolet application - a platform connecting help seekers with helpers for various tasks and services.

## Project Overview

This backend server provides API endpoints for user authentication, profile management, and address management. It uses PostgreSQL with Sequelize ORM, Supabase for file storage, and JWT for authentication.

## Technology Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL
- **ORM**: Sequelize
- **Authentication**: JSON Web Tokens (JWT)
- **File Storage**: Supabase Storage
- **Email**: Nodemailer
- **Password Hashing**: bcryptjs
- **File Upload**: Multer

## Project Structure

### Root Files
- `server.js` - Main application entry point and Express server configuration
- `package.json` - Project dependencies and scripts

### Configuration (`config/`)
Configuration modules for external services:

#### `nodemailerConfig/`
- `nodemailer.js` - Email service configuration using Nodemailer

#### `supabaseConfig/`  
- `supabase.js` - Supabase client configuration for database and storage

#### `uploadConfig/`
- `supabaseUpload.js` - File upload middleware using Supabase Storage and Multer

### Controllers (`controllers/`)
Business logic handlers for different features:

#### `authController/`
- `userController.js` - Handles user registration and authentication logic

#### `profileController/`
- `profileController.js` - Manages user profile operations (get, update)

#### `addressController/`
- `address.js` - Handles all address-related operations (CRUD operations, default addresses)

### Database (`dbConnection/`)
- `dbConfig.js` - PostgreSQL database connection configuration using Sequelize
- `dbSync.js` - Database synchronization and initialization

### Middleware (`middleware/`)
- `authMiddleware.js` - JWT token verification and authentication middleware
- `roleMiddleware.js` - Role-based access control middleware

### Models (`models/`)
Sequelize model definitions for database entities:

#### `authModel/`
- `userModel.js` - User entity model (id, googleId, fullName, email, password, profilePhoto, etc.)

#### `addressModel/`
- `addressModel.js` - Address entity model for user addresses

#### `associationModel/`
- `association.js` - Database relationships and associations between models

#### Additional Models (Planned/Future)
- `bidModel/bidModel.js` - Bidding system for tasks
- `helperModel/helperModel.js` - Helper-specific data
- `messageModel/messageModel.js` - Messaging system
- `notificationModel/notificationModel.js` - Push notifications
- `paymentModel/paymentModel.js` - Payment processing
- `queueModel/queueModel.js` - Task queue management  
- `ratingModel/ratingModel.js` - Rating and review system
- `taskModel/taskModel.js` - Task management
- `trackingModel/trackingModel.js` - Location and progress tracking

### Routes (`routes/`)
API route definitions:

#### `authRoute/`
- `authRoute.js` - Authentication endpoints

#### `profileRoute/`
- `profileRoute.js` - User profile management endpoints

#### `addressRoute/`
- `addressRoute.js` - Address management endpoints

### Services (`services/`)
- `authServices.js` - Authentication business logic and utilities

## API Endpoints

### Authentication Routes (`/api/auth`)
- `POST /api/auth/register` - User registration

### Protected User Routes (`/api/user`)
All routes require authentication token and appropriate role permissions.

#### Profile Management
- `GET /api/user/profile` - Get user profile information
- `PATCH /api/user/profile` - Update user profile (supports profile photo upload)

#### Address Management  
- `POST /api/user/address/add` - Create a new address
- `GET /api/user/address` - Get all user addresses
- `GET /api/user/address/default` - Get user's default address
- `GET /api/user/address/:addressId` - Get specific address by ID
- `PUT /api/user/address/:addressId` - Update specific address
- `DELETE /api/user/address/:addressId` - Delete specific address  
- `PATCH /api/user/address/:addressId/default` - Set address as default

### Health Check
- `GET /api/health` - Server health status check

## Authentication & Authorization

### Middleware Chain
1. **Authentication Middleware** (`authMiddleware.js`) - Verifies JWT tokens from cookies
2. **Role Middleware** (`roleMiddleware.js`) - Checks user roles (helpseeker, helper, admin)

### Supported User Roles
- `helpseeker` - Users seeking help/services
- `helper` - Users providing services
- `admin` - Administrative users

## CORS Configuration

Optimized for React Native applications:
- Allows requests without origin headers (React Native compatibility)
- Supports localhost and local network IPs for development
- Configurable frontend URL via environment variables
- Supports credentials and standard HTTP methods

## Environment Variables

The application requires the following environment variables:
- `PORT` - Server port (default: 8181)
- `FRONTEND_URL` - Frontend application URL for CORS
- Database connection variables (configured in dbConfig.js)
- Supabase configuration variables
- JWT secret keys
- Email service configuration

## Getting Started

### Installation
```bash
npm install
```

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

## Features Implemented

### Current Features
- User registration and authentication
- JWT-based session management  
- User profile management with photo upload
- Complete address management system
- Role-based access control
- File upload to Supabase Storage
- Email service integration
- Health monitoring endpoint

### Database Features
- UUID primary keys for enhanced security
- Proper model associations
- Database synchronization
- PostgreSQL with Sequelize ORM

## Security Features

- Password hashing with bcryptjs
- JWT token authentication
- Role-based authorization
- CORS protection
- Input validation and sanitization
- Secure file upload handling

## Future Development

The project structure includes models and components for upcoming features:
- Task creation and management
- Bidding system
- Real-time messaging
- Payment processing
- Rating and review system
- Push notifications
- Location tracking
- Queue management system