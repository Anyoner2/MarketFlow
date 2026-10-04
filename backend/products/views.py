from rest_framework import generics
from rest_framework.permissions import AllowAny, IsAuthenticated

from .models import Product
from .serializers import ProductSerializer


class ProductListView(generics.ListAPIView):
	permission_classes = [AllowAny]
	serializer_class = ProductSerializer

	def get_queryset(self):
		return Product.objects.filter(is_active=True, store__is_active=True).select_related('store')


class SellerProductListCreateView(generics.ListCreateAPIView):
	permission_classes = [IsAuthenticated]
	serializer_class = ProductSerializer

	def get_queryset(self):
		return Product.objects.filter(store__owner=self.request.user).select_related('store')


class SellerProductDetailView(generics.RetrieveUpdateDestroyAPIView):
	permission_classes = [IsAuthenticated]
	serializer_class = ProductSerializer

	def get_queryset(self):
		return Product.objects.filter(store__owner=self.request.user).select_related('store')
