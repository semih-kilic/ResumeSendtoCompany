const axios = require('axios');
axios.post('http://localhost:8001/validate', {email: 'test@gmail.com'})
  .then(r => console.log('OK:', r.data.verdict, r.data.score))
  .catch(e => console.log('FAIL:', e.message));
