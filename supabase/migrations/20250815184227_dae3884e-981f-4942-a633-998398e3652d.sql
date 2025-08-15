-- Delete the incorrectly formatted Alpaca11 credential  
DELETE FROM user_credentials 
WHERE name = 'My Alpaca11' 
AND user_id = 'bb1e6e8c-6302-4e2d-b218-88865b0fd2d4';