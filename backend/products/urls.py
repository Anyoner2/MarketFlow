from django.urls import path

from .views import ProductListView, SellerProductDetailView, SellerProductListCreateView

urlpatterns = [
    path('seller/products/', SellerProductListCreateView.as_view(), name='seller-product-list-create'),
    path('seller/products/<int:pk>/', SellerProductDetailView.as_view(), name='seller-product-detail'),
    path('products/', ProductListView.as_view(), name='product-list'),
]