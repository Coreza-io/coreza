from alpaca_trade_api.rest import REST

api_key = "PK8BDG4370FWIYDOFVWV"
secret_key = "D2aCWWV5pbpapn7dO9hPK2FxBEu3OAMkwEICsWCb"
base_url = "https://paper-api.alpaca.markets"

client = REST(api_key, secret_key, base_url=base_url)
print(client.get_bars("IEX", "1Day", limit=5))
