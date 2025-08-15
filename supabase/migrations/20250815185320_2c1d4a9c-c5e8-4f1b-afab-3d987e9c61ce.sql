-- Clean up all existing credentials to test the new format
DELETE FROM user_credentials 
WHERE user_id = 'bb1e6e8c-6302-4e2d-b218-88865b0fd2d4' 
AND service_type = 'alpaca';