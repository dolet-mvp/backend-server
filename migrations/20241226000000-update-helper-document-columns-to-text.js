'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Change document columns from VARCHAR(255) to TEXT to accommodate encrypted URLs
    await queryInterface.changeColumn('helpers', 'aadharCardDocument', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.changeColumn('helpers', 'addressProofDocument', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.changeColumn('helpers', 'drivingLicenseDocument', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    console.log('✅ Successfully updated helper document columns to TEXT type');
  },

  down: async (queryInterface, Sequelize) => {
    // Revert back to VARCHAR(255) if needed
    await queryInterface.changeColumn('helpers', 'aadharCardDocument', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });

    await queryInterface.changeColumn('helpers', 'addressProofDocument', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });

    await queryInterface.changeColumn('helpers', 'drivingLicenseDocument', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });

    console.log('✅ Reverted helper document columns to VARCHAR(255)');
  }
};
