from rest_framework import generics
from rest_framework.permissions import AllowAny

from .models import Product
from .serializers import ProductSerializer


class ProductListView(generics.ListAPIView):
	permission_classes = [AllowAny]
	serializer_class = ProductSerializer

	def get_queryset(self):
		return Product.objects.filter(is_active=True, store__is_active=True).select_related('store')
