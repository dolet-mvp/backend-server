const {sequelize} = require("../dbConnection/dbConfig");

const initDB = (callback) => {
  sequelize.authenticate()
    .then(() => {
      console.log('Connected to Supabase PostgreSQL');
      
      // Load all auth models first
      require('../models/authModel/helperModel');
      require('../models/authModel/helpseekerModel');
      require('../models/authModel/adminModel');
      
      // Load all other models
      require('../models/addressModel/addressModel');
      require('../models/taskModel/taskModel');
      require('../models/bidModel/bidModel');
      require('../models/paymentModel/paymentModel');
      require('../models/ratingModel/ratingModel');
      require('../models/queueModel/queueModel');
      require('../models/notificationModel/notificationModel');
      require('../models/trackingModel/trackingModel');
      require('../models/messageModel/messageModel');
      require('../models/messageModel/taskMessageModel');
      require('../models/supportModel/supportTicketModel');
      require('../models/supportModel/ticketReplyModel');
      
      // Load associations after all models are loaded
      require('../models/modelAssociation');
      
      return sequelize.sync(); // Creates tables if not exist
    })
    .then(() => {
      console.log('All models synced successfully');
      callback(); 
    })
    .catch((error) => {
      console.error('Error connecting to the database:', error);
      process.exit(1);
    });
};

module.exports = initDB;