require("dotenv").config();
const { Sequelize } = require("sequelize");

const sequelize = new Sequelize(
  process.env.SUPABASE_DB_NAME,   
  process.env.SUPABASE_DB_USER,   
  process.env.SUPABASE_DB_PASS,   
  {
    host: process.env.SUPABASE_DB_HOST,
    port: process.env.SUPABASE_DB_PORT,
    dialect: "postgres",
    dialectOptions: process.env.NODE_ENV === 'production' ? {
      ssl: {
        require: true,
        rejectUnauthorized: false, 
      },
    } : {},
    logging: false,
  }
);

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log(" Connected to Supabase PostgreSQL via Sequelize");
  } catch (error) {
    console.error(" Unable to connect to the database:", error);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };
