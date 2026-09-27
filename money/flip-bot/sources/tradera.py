"""Tradera official SOAP API (api.tradera.com/v3). WSDLs are vendored in sources/wsdl/ so zeep
loads offline; calls still go to the live endpoints declared inside them.

Verified from the WSDLs (2026-09-27): SearchAdvanced(ItemStatus, ...) -> SearchItem, BuyerService.Buy(itemId,
buyAmount), PublicService.FetchToken(userId, secretKey), RestrictedService.AddItem/AddItemImage/AddItemCommit,
SetPricesOnNonShopItems, OrderService.GetSellerOrders. NOT verified until there are keys: accepted
ItemStatus strings ("Active"/"Ended" assumed), fixed-price ItemType id, required shipping/payment fields.
"""
import base64
import logging
import os
import pathlib
from datetime import datetime, timedelta, timezone

import zeep
from zeep.helpers import serialize_object

from .blocket import Listing

WSDL = pathlib.Path(__file__).parent / "wsdl"
log = logging.getLogger("tradera")
logging.getLogger("zeep").setLevel(logging.ERROR)
TOKEN_LOGIN_URL = "https://api.tradera.com/tokenlogin.aspx?appId={app_id}&pkey={public_key}&skey={secret}"


class Tradera:
    def __init__(self, app_id, app_key, user_id=None, token=None, public_key=None, transport=None, sandbox=False):
        self.app_id, self.app_key = int(app_id), app_key
        self.user_id, self.token, self.public_key = (int(user_id) if user_id else None), token, public_key
        self.transport, self.sandbox = transport, sandbox
        self._clients = {}

    @classmethod
    def from_env(cls, **kw):
        e = os.environ
        if not (e.get("TRADERA_APP_ID") and e.get("TRADERA_APP_KEY")):
            return None
        return cls(e["TRADERA_APP_ID"], e["TRADERA_APP_KEY"], e.get("TRADERA_USER_ID"),
                   e.get("TRADERA_USER_TOKEN"), e.get("TRADERA_PUBLIC_KEY"), **kw)

    @property
    def can_act(self):
        return bool(self.user_id and self.token)

    def _svc(self, name):
        if name not in self._clients:
            kw = {"transport": self.transport} if self.transport else {}
            self._clients[name] = zeep.Client(str(WSDL / f"{name}.wsdl"), **kw)
        return self._clients[name].service

    def _headers(self, user=False):
        h = {"AuthenticationHeader": {"AppId": self.app_id, "AppKey": self.app_key},
             "ConfigurationHeader": {"Sandbox": int(self.sandbox), "MaxResultAge": 0}}
        if user:
            h["AuthorizationHeader"] = {"UserId": self.user_id, "Token": self.token}
        return h

    # --- search / comps ---
    def _search(self, query, status, page=1):
        req = {"SearchWords": query, "ItemStatus": status, "ItemsPerPage": 50, "PageNumber": page,
               "OnlyItemsWithThumbnail": False, "SearchInDescription": False, "OnlyAuctionsWithBuyNow": False,
               "CategoryId": 0, "CountyId": 0, "PriceMinimum": None, "PriceMaximum": None,
               "BidsMinimum": None, "BidsMaximum": None}  # minOccurs=1 fields; None -> xsi:nil
        res = self._svc("SearchService").SearchAdvanced(request=req, _soapheaders=self._headers())
        if res.Errors:
            raise RuntimeError(f"tradera search error: {serialize_object(res.Errors)}")
        return res.Items or []

    def search(self, query):
        """Active items as Listings. price_sek = Buy-Now price if any, else the next required bid."""
        out = []
        for it in self._search(query, "Active"):
            bin_ = it.BuyItNowPrice or 0
            out.append(Listing(
                source="tradera", id=str(it.Id), title=it.ShortDescription or "",
                price_sek=int(bin_ or it.NextBid or it.MaxBid or 0), location="", lat=None, lon=None,
                posted_at=0, url=it.ItemUrl or f"https://www.tradera.com/item/{it.Id}",
                image_urls=[it.ThumbnailLink] if it.ThumbnailLink else [],
                extra={"bin": int(bin_), "item_type": it.ItemType, "category": it.CategoryId,
                       "end_date": it.EndDate.isoformat() if it.EndDate else None, "bids": it.BidCount or 0}))
        return out

    def sold_comps(self, query, model, days=30):
        """Final prices of ended items with bids (i.e. sold) in the last `days`, matching the model."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        prices, cats = [], {}
        for it in self._search(query, "Ended"):
            if not it.HasBids or not model.matches(it.ShortDescription or ""):
                continue
            if it.EndDate and it.EndDate.replace(tzinfo=it.EndDate.tzinfo or timezone.utc) < cutoff:
                continue
            p = it.MaxBid or it.BuyItNowPrice
            if p:
                prices.append(int(p))
                cats[it.CategoryId] = cats.get(it.CategoryId, 0) + 1
        return prices, (max(cats, key=cats.get) if cats else None)

    # --- auth ---
    def login_url(self, secret):
        return TOKEN_LOGIN_URL.format(app_id=self.app_id, public_key=self.public_key or "", secret=secret)

    def fetch_token(self, user_id, secret):
        t = self._svc("PublicService").FetchToken(userId=int(user_id), secretKey=secret, _soapheaders=self._headers())
        return t.AuthToken, t.HardExpirationTime

    # --- buying ---
    def buy(self, item_id, amount):
        """Buy-Now purchase (amount = BIN price) or bid. Returns BuyStatus string."""
        r = self._svc("BuyerService").Buy(itemId=int(item_id), buyAmount=int(amount), _soapheaders=self._headers(True))
        return str(r.Status)

    # --- selling ---
    def fixed_price_item_type(self):
        types = self._svc("PublicService").GetItemTypes(_soapheaders=self._headers()) or []
        for t in types:
            d = (t.Description or "").lower()
            if any(k in d for k in ("fixed", "fast pris", "köp nu", "buy it now", "shop")):
                return t.Id
        raise RuntimeError(f"no fixed-price item type in {[(t.Id, t.Description) for t in types]}")

    def list_item(self, title, description, price, category_id, image_paths, item_type, shipping_cost=0):
        svc = self._svc("RestrictedService")
        req = {"Title": title[:80], "CategoryId": int(category_id), "Duration": 14, "Restarts": 2,
               "StartPrice": int(price), "BuyItNowPrice": int(price), "Description": description,
               "ItemType": int(item_type), "AutoCommit": False, "DescriptionLanguageCodeIso2": "sv",
               "ReservePrice": None, "AcceptedBidderId": 1, "CustomEndDate": None, "VAT": None,
               "RestartedFromItemId": None,
               "ShippingOptions": {"ItemShipping": [{"ShippingOptionId": 0, "Cost": int(shipping_cost),
                                                      "ShippingProviderId": None}]}}
        q = svc.AddItem(itemRequest=req, _soapheaders=self._headers(True))
        for path in image_paths:
            fmt = "Png" if str(path).lower().endswith(".png") else "Jpeg"
            svc.AddItemImage(requestId=q.RequestId, imageData=pathlib.Path(path).read_bytes(),
                             imageFormat=fmt, hasMega=True, _soapheaders=self._headers(True))
        svc.AddItemCommit(requestId=q.RequestId, _soapheaders=self._headers(True))
        return q.RequestId, q.ItemId

    def set_price(self, item_id, price):
        r = self._svc("RestrictedService").SetPricesOnNonShopItems(
            request={"NonShopItem": {"Id": int(item_id), "BinPrice": {"Price": int(price)}}},
            _soapheaders=self._headers(True))
        if not r.IsSuccessful:
            raise RuntimeError(f"set_price failed: {serialize_object(r.ValidationErrors)}")

    def seller_orders(self, since):
        r = self._svc("OrderService").GetSellerOrders(
            request={"FromDate": since, "ToDate": datetime.now(timezone.utc), "QueryDateMode": "CreatedDate"},
            _soapheaders=self._headers(True))
        return serialize_object(r) or {}
