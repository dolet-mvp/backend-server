const axios = require('axios');

async function testRedisState() {
  try {
    const response = await axios.get('https://dolet.pixbit.me/api/helpers/debug/redis', {
      params: { taskId: 'b7574bba-82c4-41f9-a357-fd362a4f9795' }
    });
    
    console.log('=== REDIS STATE ===');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

testRedisState();
