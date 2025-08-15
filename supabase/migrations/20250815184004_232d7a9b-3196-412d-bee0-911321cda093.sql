-- Delete incorrectly formatted credentials to allow proper recreation
DELETE FROM user_credentials 
WHERE name = 'My Alpaca10' 
AND user_id = 'bb1e6e8c-6302-4e2d-b218-88865b0fd2d4';