const {sequelize} = require("../dbConnection/dbConfig");
const User = require("../models/authModel/userModel");


const initDB = (callback) => {
  sequelize.authenticate()
    .then(() => {
      console.log('Connected to Supabase PostgreSQL');
      
      // Load all models first
      require('../models/addressModel/addressModel');
      require('../models/taskModel/taskModel');
      require('../models/bidModel/bidModel');
      require('../models/paymentModel/paymentModel');
      require('../models/ratingModel/ratingModel');
      require('../models/queueModel/queueModel');
      require('../models/notificationModel/notificationModel');
      require('../models/trackingModel/trackingModel');
      require('../models/messageModel/messageModel');
      require('../models/helperModel/helperModel');
      
      // Load associations after all models are loaded
      require('../models/associationModel/association');
      
      return sequelize.sync(); // Creates tables if not exist {alter:true}
    })
    .then(() => {
      console.log('All models synced');
      callback(); 
    })
    .catch((error) => {
      console.error('Error connecting to the database:', error);
      process.exit(1);
    });
};
module.exports = initDB;