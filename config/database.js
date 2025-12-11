require("dotenv").config();

module.exports = {
  development: {
    username: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASS,
    database: process.env.SUPABASE_DB_NAME,
    host: process.env.SUPABASE_DB_HOST,
    port: process.env.SUPABASE_DB_PORT,
    dialect: "postgres",
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
    logging: console.log,
  },
  production: {
    username: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASS,
    database: process.env.SUPABASE_DB_NAME,
    host: process.env.SUPABASE_DB_HOST,
    port: process.env.SUPABASE_DB_PORT,
    dialect: "postgres",
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
    logging: false,
  },
  test: {
    username: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASS,
    database: process.env.SUPABASE_DB_NAME,
    host: process.env.SUPABASE_DB_HOST,
    port: process.env.SUPABASE_DB_PORT,
    dialect: "postgres",
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
    logging: false,
  },
};
