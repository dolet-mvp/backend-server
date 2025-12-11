'use strict';


module.exports = {
  async up(queryInterface, Sequelize) {
    console.log('⚡ Adding performance indexes...');

    // Index 1: Find available/unassigned tasks quickly
    // Used in: getAvailableTasks, publishTask
    await queryInterface.addIndex('tasks', ['status', 'assignedHelperId'], {
      name: 'idx_tasks_status_helper',
      type: 'BTREE'
    });
    console.log('✅ Added index: idx_tasks_status_helper');

    // Index 2: Find helpseeker's tasks by status
    // Used in: getMyTasks, getTaskHistory
    await queryInterface.addIndex('tasks', ['helpseekerId', 'status'], {
      name: 'idx_tasks_helpseeker_status',
      type: 'BTREE'
    });
    console.log('✅ Added index: idx_tasks_helpseeker_status');

    // Index 3: Find helper's assigned tasks
    // Used in: getHelperTasks, getActiveTask
    await queryInterface.addIndex('tasks', ['assignedHelperId', 'status'], {
      name: 'idx_tasks_helper_status',
      type: 'BTREE'
    });
    console.log('✅ Added index: idx_tasks_helper_status');

    // Index 4: Find helper's default address quickly
    // Used in: toggleAvailability, getHelperLocation
    await queryInterface.addIndex('addresses', ['helperId', 'isDefault'], {
      name: 'idx_addresses_helper_default',
      type: 'BTREE'
    });
    console.log('✅ Added index: idx_addresses_helper_default');

    // Index 5: Find task bids by status
    // Used in: getTaskBids, acceptBid
    await queryInterface.addIndex('bids', ['taskId', 'status'], {
      name: 'idx_bids_task_status',
      type: 'BTREE'
    });
    console.log('✅ Added index: idx_bids_task_status');

    // Index 6: Find helper's bids
    // Used in: getHelperBids, getBidHistory
    await queryInterface.addIndex('bids', ['helperId', 'status'], {
      name: 'idx_bids_helper_status',
      type: 'BTREE'
    });
    console.log('✅ Added index: idx_bids_helper_status');

    // Index 7: Optimize task location queries
    // Used in: findNearbyTasks (if spatial queries are added later)
    await queryInterface.addIndex('tasks', ['createdAt'], {
      name: 'idx_tasks_created_at',
      type: 'BTREE'
    });
    console.log('✅ Added index: idx_tasks_created_at');

    console.log('🎉 All performance indexes added successfully!');
  },

  async down(queryInterface, Sequelize) {
    console.log('⚠️ Removing performance indexes...');

    await queryInterface.removeIndex('tasks', 'idx_tasks_status_helper');
    await queryInterface.removeIndex('tasks', 'idx_tasks_helpseeker_status');
    await queryInterface.removeIndex('tasks', 'idx_tasks_helper_status');
    await queryInterface.removeIndex('addresses', 'idx_addresses_helper_default');
    await queryInterface.removeIndex('bids', 'idx_bids_task_status');
    await queryInterface.removeIndex('bids', 'idx_bids_helper_status');
    await queryInterface.removeIndex('tasks', 'idx_tasks_created_at');

    console.log('✅ All indexes removed');
  }
};
